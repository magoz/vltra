import path from 'node:path'
import { Clock, Effect, Option, Schema } from 'effect'
import { withConnection } from '@/lib/data/fleet/actions'
import { Branch, fallbackBranch, parseSuggestion, suggestionPrompt } from '@/lib/data/fleet/branch'
import { busySessions, isWithin, latestSessionIn } from '@/lib/data/fleet/checkouts'
import { NotACheckoutError, RetireRefusedError } from '@/lib/data/fleet/errors'
import { folderGone } from '@/lib/data/fleet/folders'
import { snapshotRows } from '@/lib/data/fleet/snapshot'
import { FleetStore } from '@/lib/data/fleet/store'
import type {
  BranchSuggestion,
  FleetRow,
  LauncherEntry,
  LauncherList,
  LauncherWorktree,
  OpenedCheckout,
  ProjectRecord,
  PullRequest,
  RepoCheckout,
  SessionTally
} from '@/lib/data/fleet/types'
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

export const RetireWorktreeInput = Schema.Struct({ projectID: Id, directory: Directory })

export type RetireWorktreeInput = typeof RetireWorktreeInput.Type

export const SuggestBranchInput = Schema.Struct({ task: Task })

export type SuggestBranchInput = typeof SuggestBranchInput.Type

export const DismissLaunchInput = Schema.Struct({ id: Id })

export type DismissLaunchInput = typeof DismissLaunchInput.Type

const emptyTally: SessionTally = { blocked: 0, working: 0, finished: 0, handled: 0 }

type Place = { readonly directory: string; readonly rows: Array<FleetRow> }

const summarize = (rows: ReadonlyArray<FleetRow>) => {
  const latest = rows.reduce<FleetRow | undefined>(
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
  /** PR status per worktree directory. */
  readonly pullRequests: ReadonlyMap<string, PullRequest>
  readonly projects: ReadonlyArray<ProjectRecord>
  /** The live root rows (any state). */
  readonly rows: ReadonlyArray<FleetRow>
  readonly now: number
}

/**
 * The launcher's entries: each repository with OpenCode's project for it (same canonical
 * directory) and its linked worktrees; every live root row whose folder still exists counts
 * toward the innermost checkout containing its directory. Repositories order by their latest
 * agent activity (primary and worktrees), then by name; worktrees by their own, then by
 * directory.
 */
export const buildLauncher = (inputs: LauncherInputs): LauncherList => {
  const places = new Map<string, Place>()

  for (const repo of inputs.repos) {
    for (const directory of [repo.directory, ...repo.worktrees.map(item => item.directory)]) {
      places.set(directory, { directory, rows: [] })
    }
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

  const entries = inputs.repos.map((repo): LauncherEntry => {
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
      name: repo.name,
      directory: repo.directory,
      projectID: projectByDirectory.get(repo.directory)?.id ?? own[0]?.projectID,
      ...summary,
      worktrees,
      lastActivity: known.length === 0 ? undefined : Math.max(...known)
    }
  })

  return {
    generatedAt: inputs.now,
    entries: entries.toSorted(
      (left, right) =>
        byRecency(left.lastActivity, right.lastActivity) || left.name.localeCompare(right.name)
    )
  }
}

/** Waiting on `gh` stays bounded inside `Repos`; this only caps the fibers waiting on it. */
const prConcurrency = 16

/**
 * `GET /api/fleet/launcher`: scans the launcher roots (and OpenCode's project folders), looks up
 * each worktree branch's PR, and projects them with the watcher's rows.
 */
export const loadLauncher = Effect.gen(function* () {
  const view = yield* Effect.flatMap(FleetStore, store => store.view)
  const repos = yield* Repos
  // The global project's directory is `/`, never a repository.
  const projects = Array.from(view.model.projects.values()).filter(item => item.directory !== '/')
  const checkouts = yield* repos.list(projects.map(project => project.directory))

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

/**
 * Opening a repository or worktree from the launcher: its latest root session, or a new empty
 * session there when it has none (only in a real checkout on Box).
 */
export const openCheckout = (input: OpenCheckoutInput) =>
  Effect.gen(function* () {
    const view = yield* Effect.flatMap(FleetStore, store => store.view)
    const latest = latestSessionIn(snapshotRows(view.snapshot), input.directory)

    if (latest !== undefined) {
      const opened: OpenedCheckout = { sessionID: latest, created: false }

      return opened
    }

    const info = yield* Effect.flatMap(Repos, repos => repos.inspect(input.directory))

    if (Option.isNone(info)) {
      return yield* new NotACheckoutError({ directory: input.directory })
    }

    const session = yield* withConnection(connection =>
      connection.createSession({ directory: info.value.directory, title: undefined })
    )

    const opened: OpenedCheckout = { sessionID: session.id, created: true }

    return opened
  }).pipe(Effect.withSpan('launcher.open'))

/**
 * Why a worktree cannot be retired from Fleet, if it cannot: only a linked worktree carrying the
 * dotfiles marker (OpenCode/Fleet-created) whose sessions are all idle (none working or blocked).
 */
export const retireRefusal = (
  info: Option.Option<CheckoutInfo>,
  rows: ReadonlyArray<FleetRow>
): Option.Option<string> => {
  if (Option.isNone(info)) return Option.some('Not a git checkout on Box')

  if (!info.value.linked) return Option.some('The primary checkout cannot be retired')

  if (info.value.owner !== 'dotfiles') {
    return Option.some(
      'Not a Fleet/OpenCode worktree (no dotfiles marker); retire it through Herdr'
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
    const view = yield* Effect.flatMap(FleetStore, store => store.view)
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
