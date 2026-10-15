import { randomUUID } from 'node:crypto'
import { Clock, Config, Context, Duration, Effect, Layer, Match, Option, Result } from 'effect'
import { branchToName } from '@/lib/data/fleet/branch'
import {
  LaunchInProgressError,
  LaunchNotFoundError,
  NotACheckoutError
} from '@/lib/data/fleet/errors'
import type { LaunchInput } from '@/lib/data/fleet/launcher'
import { FleetStore } from '@/lib/data/fleet/store'
import type { Launch } from '@/lib/data/fleet/types'
import { OpenCodeInvalidInputError, OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import type { OpenCodeRequestError } from '@/lib/services/opencode/errors'
import { sanitizeMessage } from '@/lib/services/opencode/mapping'
import { OpenCode } from '@/lib/services/opencode/service'
import type { RejectableError } from '@/lib/services/opencode/service'
import { Repos } from '@/lib/services/repos/service'
import { makeWatcher, watcherSocket } from '@/lib/services/watcher/live-layer'
import { Watcher } from '@/lib/services/watcher/service'
import type {
  WatcherRefusedError,
  WatcherRun,
  WatcherUnavailableError
} from '@/lib/services/watcher/service'

// The launch registry (DESIGN.md "Launcher and worktrees"): a launch provisions a worktree through
// OpenCode, then creates a session there and sends the task. Where that runs is a backend:
//
// - `watcher` (production): the Watcher daemon runs it, so a launch survives Fleet restarts (a
//   `pnpm ship` used to cut `worktree.create`, which OpenCode cancels when its client goes away);
//   Fleet follows it and, after its own restart, picks the running ones back up.
// - `opencode`: Fleet runs it in a fiber of the runtime (tests, and `pnpm dev` against a throwaway
//   server: `OPENCODE_URL` set means no Watcher, so a dev Fleet never launches for real).
//
// The registry lives in the store (so `GET /api/fleet` and the event stream carry it) and in
// memory only.

export type LaunchStartError =
  | NotACheckoutError
  | OpenCodeInvalidInputError
  | OpenCodeUnavailableError
  | OpenCodeRequestError
  | RejectableError
  | WatcherUnavailableError
  | WatcherRefusedError

export type LaunchesOperations = {
  /** Starts the launch in the background; returns it as registered (`provisioning`). */
  readonly start: (input: LaunchInput) => Effect.Effect<Launch, LaunchStartError>
  /** Removes a failed or ready launch from the list. */
  readonly dismiss: (id: string) => Effect.Effect<void, LaunchNotFoundError | LaunchInProgressError>
}

export class Launches extends Context.Service<Launches, LaunchesOperations>()('@fleet/Launches') {}

export type LaunchesOptions = {
  /** How long a ready launch stays listed. */
  readonly readyFor: Duration.Input
}

export const defaultLaunchesOptions: LaunchesOptions = { readyFor: '10 minutes' }

/** Applies a change to the launch's entry (timestamped by the registry). */
export type LaunchUpdate = (patch: Partial<Launch>) => Effect.Effect<void>

/** Reports a launch's progress until it ends; how it ended. */
export type LaunchFollow = (update: LaunchUpdate) => Effect.Effect<'ready' | 'failed'>

export type LaunchBackendOperations = {
  /** Starts a launch of `branch` (worktree `name`) in `repo`; its id and how to follow it. */
  readonly begin: (input: {
    readonly repo: string
    readonly branch: string
    readonly name: string
    readonly task: string
  }) => Effect.Effect<{ readonly id: string; readonly follow: LaunchFollow }, LaunchStartError>
  /** Launches still running from before a Fleet restart, as entries to list and follow. */
  readonly restore: Effect.Effect<
    ReadonlyArray<{ readonly launch: Launch; readonly follow: LaunchFollow }>
  >
}

export class LaunchBackend extends Context.Service<LaunchBackend, LaunchBackendOperations>()(
  '@fleet/LaunchBackend'
) {}

/** One step of a launch, for the failure text and what it leaves behind. */
type Step = 'location' | 'worktree' | 'session' | 'prompt'

const stepFailure: Readonly<Record<Step, string>> = {
  location: 'Opening the repository failed',
  worktree: 'Creating the worktree failed',
  session: 'Creating the session failed',
  prompt: 'Sending the task failed'
}

/** User-safe words for a failed step: OpenCode's own refusal, else what did not answer. */
export const failureText = (step: Step, error: RejectableError): string =>
  `${stepFailure[step]}: ${Match.value(error).pipe(
    Match.tagsExhaustive({
      OpenCodeRejectedError: rejected => rejected.message,
      OpenCodeRequestError: failed =>
        `OpenCode did not complete ${failed.operation} (${sanitizeMessage(failed.message)})`,
      OpenCodeInvalidInputError: invalid => invalid.message,
      SessionNotFoundError: () => 'the session disappeared'
    })
  )}`

/** What a failure at `step` leaves on disk and in OpenCode. */
export const preservedText = (
  step: Step,
  directory: string | undefined,
  sessionID: string | undefined
): string | undefined => {
  switch (step) {
    case 'location':
    case 'worktree':
      // The plugin's message says where a half-provisioned checkout was kept, if anywhere.
      return undefined
    case 'session':
      return directory === undefined ? undefined : `Worktree kept at ${directory}`
    case 'prompt':
      return directory === undefined || sessionID === undefined
        ? undefined
        : `Worktree kept at ${directory}; session ${sessionID} created without the task`
  }
}

const repoName = (repo: string) => repo.split('/').findLast(part => part !== '') ?? repo

/** Fleet runs the launch itself, in a fiber of the runtime. */
export const makeInProcessBackend = Effect.gen(function* () {
  const opencode = yield* OpenCode

  const begin: LaunchBackendOperations['begin'] = input =>
    Effect.gen(function* () {
      const connection = yield* opencode.connect
      const location = yield* connection.resolveLocation(input.repo)

      const follow: LaunchFollow = update => {
        const fail = (step: Step, error: RejectableError, directory?: string, sessionID?: string) =>
          Effect.andThen(
            Effect.logWarning('Launch failed', input.branch, step, error.message),
            update({
              status: 'failed',
              error: failureText(step, error),
              preserved: preservedText(step, directory, sessionID)
            })
          ).pipe(Effect.as('failed' as const))

        return Effect.gen(function* () {
          const created = yield* connection
            .createWorktree({ projectID: location.projectID, name: input.name })
            .pipe(Effect.result)

          if (Result.isFailure(created)) return yield* fail('worktree', created.failure)

          const directory = created.success

          yield* update({ status: 'creating-session', directory })

          // Untitled, so OpenCode names the session from the task (it only titles untitled ones).
          const session = yield* connection
            .createSession({ directory, title: undefined })
            .pipe(Effect.result)

          if (Result.isFailure(session)) return yield* fail('session', session.failure, directory)

          const sessionID = session.success.id

          yield* update({ sessionID })

          const prompted = yield* connection
            .prompt({ sessionID, text: input.task })
            .pipe(Effect.result)

          if (Result.isFailure(prompted)) {
            return yield* fail('prompt', prompted.failure, directory, sessionID)
          }

          yield* update({ status: 'ready' })
          yield* Effect.logInfo('Launch ready', input.branch, directory, sessionID)

          return 'ready' as const
        })
      }

      return { id: randomUUID(), follow }
    })

  const backend: LaunchBackendOperations = { begin, restore: Effect.succeed([]) }

  return backend
})

/** How often Fleet asks Watcher about a launch it follows. */
const pollEvery = Duration.seconds(1)

/** Past this long without an answer from Watcher, Fleet stops following (the launch goes on). */
const lostAfter = Duration.minutes(40)

const watcherStep = (step: string | null): Step | undefined =>
  step === 'location' || step === 'worktree' || step === 'session' || step === 'prompt'
    ? step
    : undefined

/** A Watcher run as the change to Fleet's entry, and whether (how) the launch ended. */
export type WatcherProgress = {
  readonly patch: Partial<Launch>
  readonly end: Option.Option<'ready' | 'failed'>
}

export const watcherPatch = (run: WatcherRun): WatcherProgress => {
  const directory = run.directory ?? undefined
  const sessionID = run.sessionId ?? undefined

  switch (run.status) {
    case 'launching':
      return {
        patch:
          directory === undefined
            ? { status: 'provisioning' }
            : { status: 'creating-session', directory },
        end: Option.none()
      }
    case 'launched':
      return { patch: { status: 'ready', directory, sessionID }, end: Option.some('ready') }
    case 'failed': {
      const step = watcherStep(run.step)
      const reason = sanitizeMessage(run.error ?? 'unknown')

      return {
        patch: {
          status: 'failed',
          directory,
          error:
            step === undefined ? `The launch failed: ${reason}` : `${stepFailure[step]}: ${reason}`,
          preserved:
            step === undefined
              ? undefined
              : preservedText(step, directory, step === 'prompt' ? sessionID : undefined)
        },
        end: Option.some('failed')
      }
    }
  }
}

/** Watcher runs the launch; Fleet follows it. */
export const makeWatcherBackend = Effect.gen(function* () {
  const watcher = yield* Watcher

  const followRun =
    (id: string): LaunchFollow =>
    update =>
      Effect.gen(function* () {
        let lastAnswer = yield* Clock.currentTimeMillis

        for (;;) {
          const answer = yield* watcher.run(id).pipe(Effect.result)
          const now = yield* Clock.currentTimeMillis

          if (Result.isSuccess(answer)) {
            lastAnswer = now

            const found = answer.success

            if (Option.isNone(found)) {
              yield* update({ status: 'failed', error: 'Watcher no longer knows this launch' })

              return 'failed' as const
            }

            const { patch, end } = watcherPatch(found.value)

            yield* update(patch)

            if (Option.isSome(end)) return end.value
          } else if (now - lastAnswer > Duration.toMillis(lostAfter)) {
            yield* update({
              status: 'failed',
              error: `Fleet lost track of the launch (${answer.failure.message}); see \`watcher run show ${id}\``
            })

            return 'failed' as const
          }

          yield* Effect.sleep(pollEvery)
        }
      })

  const begin: LaunchBackendOperations['begin'] = input =>
    Effect.map(
      watcher.launch({ repo: input.repo, branch: input.branch, prompt: input.task }),
      run => ({ id: run.id, follow: followRun(run.id) })
    )

  const restore = watcher.launching.pipe(
    Effect.map(runs =>
      runs.map(run => {
        const repo = run.repo ?? ''

        const launch: Launch = {
          id: run.id,
          repo,
          repoName: repoName(repo),
          branch: run.branch ?? '',
          task: run.prompt ?? '',
          status: run.directory === null ? 'provisioning' : 'creating-session',
          directory: run.directory ?? undefined,
          startedAt: run.createdAt,
          updatedAt: run.updatedAt
        }

        return { launch, follow: followRun(run.id) }
      })
    ),
    Effect.tapError(error => Effect.logWarning('Running launches not restored', error.message)),
    Effect.orElseSucceed(() => [])
  )

  const backend: LaunchBackendOperations = { begin, restore }

  return backend
})

/**
 * Which backend: `FLEET_LAUNCHER` (`watcher` | `opencode`); by default `watcher`, unless
 * `OPENCODE_URL` points Fleet at an explicit (throwaway) server, where launches stay in-process.
 */
export const launcherBackend = Config.all({
  explicit: Config.option(Config.literals(['watcher', 'opencode'], 'FLEET_LAUNCHER')),
  openCodeUrl: Config.option(Config.nonEmptyString('OPENCODE_URL'))
}).pipe(
  Config.map(({ explicit, openCodeUrl }) =>
    Option.getOrElse(explicit, () => (Option.isSome(openCodeUrl) ? 'opencode' : 'watcher'))
  )
)

export const InProcessBackendLive = Layer.effect(LaunchBackend, makeInProcessBackend)

const invalidConfiguration = (error: Config.ConfigError) =>
  new OpenCodeUnavailableError({ message: `Invalid configuration: ${error.message}` })

export const LaunchBackendLive = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* launcherBackend) === 'opencode') return InProcessBackendLive

    const watcher = Watcher.of(makeWatcher(yield* watcherSocket))

    return Layer.effect(LaunchBackend, makeWatcherBackend).pipe(
      Layer.provide(Layer.succeed(Watcher, watcher))
    )
  }).pipe(Effect.mapError(invalidConfiguration))
)

export const makeLaunches = (options: LaunchesOptions) =>
  Effect.gen(function* () {
    const store = yield* FleetStore
    const repos = yield* Repos
    const backend = yield* LaunchBackend
    const scope = yield* Effect.scope

    const update =
      (id: string): LaunchUpdate =>
      patch =>
        Effect.flatMap(Clock.currentTimeMillis, now =>
          store.updateLaunches(list =>
            list.map(launch =>
              launch.id === id ? { ...launch, ...patch, updatedAt: now } : launch
            )
          )
        )

    const remove = (id: string) =>
      store.updateLaunches(list => list.filter(launch => launch.id !== id))

    /** Follows a launch to its end; a ready one stays listed for `readyFor`, then leaves. */
    const track = (id: string, follow: LaunchFollow) =>
      Effect.gen(function* () {
        const end = yield* follow(update(id))

        if (end === 'ready') {
          yield* Effect.sleep(options.readyFor)
          yield* remove(id)
        }
      })

    const start: LaunchesOperations['start'] = input =>
      Effect.gen(function* () {
        const name = branchToName(input.branch)

        if (Option.isNone(name)) {
          return yield* new OpenCodeInvalidInputError({
            field: 'branch',
            message: `No exact worktree name for ${input.branch}`
          })
        }

        const info = yield* repos.inspect(input.repoDir)

        if (Option.isNone(info) || info.value.linked) {
          return yield* new NotACheckoutError({ directory: input.repoDir })
        }

        const repo = info.value.directory
        const task = input.task.trim()
        const begun = yield* backend.begin({ repo, branch: input.branch, name: name.value, task })
        const now = yield* Clock.currentTimeMillis

        const launch: Launch = {
          id: begun.id,
          repo,
          repoName: repoName(repo),
          branch: input.branch,
          task,
          status: 'provisioning',
          startedAt: now,
          updatedAt: now
        }

        yield* store.updateLaunches(list => [...list, launch])
        yield* Effect.logInfo('Launch started', launch.id, launch.branch, repo)
        yield* Effect.forkIn(track(launch.id, begun.follow), scope)

        return launch
      }).pipe(Effect.withSpan('launches.start'))

    const dismiss: LaunchesOperations['dismiss'] = id =>
      Effect.gen(function* () {
        const launch = (yield* store.view).launches.find(item => item.id === id)

        if (launch === undefined) return yield* new LaunchNotFoundError({ id })

        if (launch.status !== 'failed' && launch.status !== 'ready') {
          return yield* new LaunchInProgressError({ id })
        }

        yield* remove(id)
      })

    // Launches Watcher kept running through a Fleet restart: listed and followed again.
    const restored = yield* backend.restore

    if (restored.length > 0) {
      yield* store.updateLaunches(list => [...list, ...restored.map(entry => entry.launch)])
      yield* Effect.forEach(
        restored,
        entry => Effect.forkIn(track(entry.launch.id, entry.follow), scope),
        { discard: true }
      )
      yield* Effect.logInfo('Launches restored from Watcher', restored.length)
    }

    const operations: LaunchesOperations = { start, dismiss }

    return operations
  })

/** The registry, with its background launches scoped to the runtime and its backend chosen by
 * configuration. */
export const LaunchesLive = (options: LaunchesOptions = defaultLaunchesOptions) =>
  Layer.effect(Launches, makeLaunches(options)).pipe(Layer.provide(LaunchBackendLive))
