import path from 'node:path'
import { Clock, Effect, Option, Schema } from 'effect'
import { withConnection } from '@/lib/data/vltra/actions'
import { Branch, fallbackBranch, parseSuggestion, suggestionPrompt } from '@/lib/data/vltra/branch'
import { busySessions, isWithin, latestSessionIn } from '@/lib/data/vltra/checkouts'
import { NotACheckoutError, RetireRefusedError } from '@/lib/data/vltra/errors'
import { folderGone } from '@/lib/data/vltra/folders'
import { snapshotRows } from '@/lib/data/vltra/snapshot'
import { VltraStore } from '@/lib/data/vltra/store'
import type {
  BranchSuggestion,
  VltraRow,
  LauncherEntry,
  LauncherList,
  LauncherWorktree,
  OpenedCheckout,
  ProjectRecord,
  PullRequest,
  RepoCheckout,
  SessionTally
} from '@/lib/data/vltra/types'
import { Repos } from '@/lib/services/repos/service'
import type { CheckoutInfo } from '@/lib/services/repos/service'

// The launcher (DESIGN.md "Launcher and worktrees"): the repositories on Box merged with
// OpenCode's projects and the live rows, branch suggestions, opening a checkout, and retiring a
// worktree. The projection and the guards are pure; the Effects run at the boundaries.

const Id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200))

/** An absolute path (the server checks it is a checkout). */
export const Directory = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter((value: string) => path.isAbsolute(value), { message: 'Absolute path' })
)

/** The task a new worktree's agent gets (its first prompt and the session title). */
export const Task = Schema.String.check(
  Schema.makeFilter((value: string) => value.trim() !== '', { message: 'Describe the task' }),
  Schema.isMaxLength(100_000)
)

export const LaunchInput = Schema.Struct({ repoDir: Directory, branch: Branch, task: Task })

export type LaunchInput = typeof LaunchInput.Type

export const OpenCheckoutInput = Schema.Struct({ directory: Directory })

export type OpenCheckoutInput = typeof OpenCheckoutInput.Type

export const NewSessionInput = Schema.Struct({ directory: Directory })

export type NewSessionInput = typeof NewSessionInput.Type

/** A session the launcher just created. */
export type NewSession = { readonly sessionID: string }

export const RetireWorktreeInput = Schema.Struct({ projectID: Id, directory: Directory })

export type RetireWorktreeInput = typeof RetireWorktreeInput.Type

export const SuggestBranchInput = Schema.Struct({ task: Task })

export type SuggestBranchInput = typeof SuggestBranchInput.Type

export const DismissLaunchInput = Schema.Struct({ id: Id })

export type DismissLaunchInput = typeof DismissLaunchInput.Type

const emptyTally: SessionTally = { blocked: 0, working: 0, finished: 0, handled: 0 }

type Place = { readonly directory: string; readonly rows: Array<VltraRow> }

const summarize = (rows: ReadonlyArray<VltraRow>) => {
  const latest = rows.reduce<VltraRow | undefined>(
    (best, row) => (best === undefined || row.activeAt > best.activeAt ? row : best),
    undefined
  )

  const sessions = { ...emptyTally }

  for (const row of rows) sessions[row.state] += 1

  return { sessions, latestSession: latest?.id, activeAt: latest?.activeAt }
}

const byRecency = (left: number | undefined, right: number | undefined) =>
  (right ?? Number.NEGATIVE_INFINITY) - (left ?? Number.NEGATIVE_INFINITY)

const unknownPullRequest: PullRequest = { state: 'unknown' }

export type LauncherInputs = {
  readonly repos: ReadonlyArray<RepoCheckout>
  /** Plain-folder launcher roots (`Repos.folders`). */
  readonly folders: ReadonlyArray<string>
  /** PR status per worktree directory. */
  readonly pullRequests: ReadonlyMap<string, PullRequest>
  readonly projects: ReadonlyArray<ProjectRecord>
  /** The live root rows (any state). */
  readonly rows: ReadonlyArray<VltraRow>
  readonly now: number
}

/**
 * The launcher's entries: each repository with OpenCode's project for it (same canonical
 * directory) and its linked worktrees, and each plain-folder root; every live root row whose
 * folder still exists counts toward the innermost checkout or folder containing its directory.
 * Entries order by their latest agent activity (a repository's primary and worktrees), then by
 * name; worktrees by their own, then by directory.
 */
export const buildLauncher = (inputs: LauncherInputs): LauncherList => {
  const places = new Map<string, Place>()

  for (const directory of [
    ...inputs.folders,
    ...inputs.repos.flatMap(repo => [repo.directory, ...repo.worktrees.map(item => item.directory)])
  ]) {
    places.set(directory, { directory, rows: [] })
  }

  // Innermost first, so a nested checkout wins over the one around it.
  const ordered = Array.from(places.values()).toSorted(
    (left, right) => right.directory.length - left.directory.length
  )

  for (const row of inputs.rows) {
    if (row.gone) continue

    ordered.find(place => isWithin(row.directory, place.directory))?.rows.push(row)
  }

  const placeRows = (directory: string) => places.get(directory)?.rows ?? []
  const projectByDirectory = new Map(inputs.projects.map(project => [project.directory, project]))

  const repos = inputs.repos.map((repo): LauncherEntry => {
    const own = placeRows(repo.directory)

    const worktrees = repo.worktrees
      .map((worktree): LauncherWorktree => ({
        directory: worktree.directory,
        branch: worktree.branch,
        owner: worktree.owner,
        pr: inputs.pullRequests.get(worktree.directory) ?? unknownPullRequest,
        ...summarize(placeRows(worktree.directory))
      }))
      .toSorted(
        (left, right) =>
          byRecency(left.activeAt, right.activeAt) || left.directory.localeCompare(right.directory)
      )

    const summary = summarize(own)
    const activity = [summary.activeAt, ...worktrees.map(worktree => worktree.activeAt)]
    const known = activity.filter(at => at !== undefined)

    return {
      kind: 'repo',
      name: repo.name,
      directory: repo.directory,
      projectID: projectByDirectory.get(repo.directory)?.id ?? own[0]?.projectID,
      ...summary,
      worktrees,
      lastActivity: known.length === 0 ? undefined : Math.max(...known)
    }
  })

  const folders = inputs.folders.map((directory): LauncherEntry => {
    const summary = summarize(placeRows(directory))

    return {
      kind: 'folder',
      name: path.basename(directory),
      directory,
      ...summary,
      worktrees: [],
      lastActivity: summary.activeAt
    }
  })

  return {
    generatedAt: inputs.now,
    entries: [...repos, ...folders].toSorted(
      (left, right) =>
        byRecency(left.lastActivity, right.lastActivity) || left.name.localeCompare(right.name)
    )
  }
}

/** Waiting on `gh` stays bounded inside `Repos`; this only caps the fibers waiting on it. */
const prConcurrency = 16

/**
 * `GET /api/vltra/launcher`: scans the launcher roots (and OpenCode's project folders), looks up
 * each worktree branch's PR, and projects them with the watcher's rows.
 */
export const loadLauncher = Effect.gen(function* () {
  const view = yield* Effect.flatMap(VltraStore, store => store.view)
  const repos = yield* Repos
  // The global project's directory is `/`, never a repository.
  const projects = Array.from(view.model.projects.values()).filter(item => item.directory !== '/')

  const [checkouts, folders] = yield* Effect.all(
    [repos.list(projects.map(project => project.directory)), repos.folders],
    { concurrency: 2 }
  )

  const pullRequests = yield* Effect.forEach(
    checkouts.flatMap(repo =>
      repo.worktrees.flatMap(worktree =>
        worktree.branch === undefined
          ? []
          : [{ repo: repo.directory, branch: worktree.branch, directory: worktree.directory }]
      )
    ),
    item =>
      Effect.map(
        repos.pullRequest({ repo: item.repo, branch: item.branch }),
        pr => [item.directory, pr] as const
      ),
    { concurrency: prConcurrency }
  )

  return buildLauncher({
    repos: checkouts,
    folders,
    pullRequests: new Map(pullRequests),
    projects,
    rows: snapshotRows(view.snapshot),
    now: yield* Clock.currentTimeMillis
  })
}).pipe(Effect.withSpan('launcher.load'))

/** How long the model may take before the fallback slug is used. */
export const suggestionTimeout = '4 seconds'

/**
 * One conventional branch name for `task`: OpenCode's `generate.text` (default model) validated
 * strictly, else (any failure, invalid output, or no answer within `suggestionTimeout`) the
 * deterministic fallback slug. Never fails.
 */
export const suggestBranch = (input: SuggestBranchInput) =>
  withConnection(connection => connection.generateText(suggestionPrompt(input.task))).pipe(
    Effect.timeout(suggestionTimeout),
    Effect.map(parseSuggestion),
    Effect.tapError(error => Effect.logDebug('Branch suggestion unavailable', error.message)),
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map((suggested): BranchSuggestion =>
      Option.match(suggested, {
        onNone: () => ({ branch: fallbackBranch(input.task), source: 'fallback' }),
        onSome: branch => ({ branch, source: 'model' })
      })
    ),
    Effect.withSpan('launcher.suggest-branch')
  )

/** Where the launcher may start a session: a git checkout on Box, else a plain-folder root. */
const sessionDirectory = (directory: string) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const info = yield* repos.inspect(directory)

    if (Option.isSome(info)) return Option.some(info.value.directory)

    const folders = yield* repos.folders

    return folders.includes(directory) ? Option.some(directory) : Option.none<string>()
  })

/**
 * A new empty session in a repository, worktree or plain-folder root (the launcher's Enter),
 * never resuming one. Refused anywhere else.
 */
export const newSession = (input: NewSessionInput) =>
  Effect.gen(function* () {
    const directory = yield* sessionDirectory(input.directory)

    if (Option.isNone(directory)) {
      return yield* new NotACheckoutError({ directory: input.directory })
    }

    const session = yield* withConnection(connection =>
      connection.createSession({ directory: directory.value, title: undefined })
    )

    const created: NewSession = { sessionID: session.id }

    return created
  }).pipe(Effect.withSpan('launcher.new-session'))

/**
 * Opening a repository or worktree (the terminal plugin): its latest root session, or a new empty
 * session there when it has none (only where `newSession` may start one).
 */
export const openCheckout = (input: OpenCheckoutInput) =>
  Effect.gen(function* () {
    const view = yield* Effect.flatMap(VltraStore, store => store.view)
    const latest = latestSessionIn(snapshotRows(view.snapshot), input.directory)

    if (latest !== undefined) {
      const opened: OpenedCheckout = { sessionID: latest, created: false }

      return opened
    }

    const { sessionID } = yield* newSession(input)
    const opened: OpenedCheckout = { sessionID, created: true }

    return opened
  }).pipe(Effect.withSpan('launcher.open'))

/**
 * Why a worktree cannot be retired from Vltra, if it cannot: only a linked worktree carrying the
 * dotfiles marker (OpenCode/Vltra-created) whose sessions are all idle (none working or blocked).
 */
export const retireRefusal = (
  info: Option.Option<CheckoutInfo>,
  rows: ReadonlyArray<VltraRow>
): Option.Option<string> => {
  if (Option.isNone(info)) return Option.some('Not a git checkout on Box')

  if (!info.value.linked) return Option.some('The primary checkout cannot be retired')

  if (info.value.owner !== 'dotfiles') {
    return Option.some(
      'Not a Vltra/OpenCode worktree (no dotfiles marker); retire it through Herdr'
    )
  }

  const busy = busySessions(rows, info.value.directory)

  if (busy.length > 0) {
    return Option.some(
      `${busy.length} ${busy.length === 1 ? 'session there is' : 'sessions there are'} working or blocked`
    )
  }

  return Option.none()
}

/**
 * Retire a dotfiles-owned worktree: OpenCode `worktree.remove({ force: false })`, which the plugin
 * turns into `worktree-manage` retirement (leases released, never forced, branch kept). Refused
 * unless `retireRefusal` allows it; OpenCode's own refusals (dirty checkout, ...) come back as
 * `OpenCodeRejectedError`. Its sessions then count as "folder deleted" (handled) at once.
 */
export const retireWorktree = (input: RetireWorktreeInput) =>
  Effect.gen(function* () {
    const info = yield* Effect.flatMap(Repos, repos => repos.inspect(input.directory))
    const view = yield* Effect.flatMap(VltraStore, store => store.view)
    const refusal = retireRefusal(info, snapshotRows(view.snapshot))

    if (Option.isSome(refusal)) {
      return yield* new RetireRefusedError({ directory: input.directory, reason: refusal.value })
    }

    const directory = Option.match(info, {
      onNone: () => input.directory,
      onSome: value => value.directory
    })

    yield* withConnection(connection =>
      connection.removeWorktree({ projectID: input.projectID, directory })
    )

    yield* folderGone(input.directory)

    if (directory !== input.directory) yield* folderGone(directory)
  }).pipe(Effect.withSpan('launcher.retire'))
