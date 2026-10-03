import { randomUUID } from 'node:crypto'
import { Clock, Context, Duration, Effect, Layer, Match, Option } from 'effect'
import { branchToName } from '@/lib/data/fleet/branch'
import {
  LaunchInProgressError,
  LaunchNotFoundError,
  NotACheckoutError
} from '@/lib/data/fleet/errors'
import type { LaunchInput } from '@/lib/data/fleet/launcher'
import { FleetStore } from '@/lib/data/fleet/store'
import type { Launch } from '@/lib/data/fleet/types'
import { OpenCodeInvalidInputError } from '@/lib/services/opencode/errors'
import type { OpenCodeRequestError, OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import { sanitizeMessage } from '@/lib/services/opencode/mapping'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection, RejectableError } from '@/lib/services/opencode/service'
import { Repos } from '@/lib/services/repos/service'

// The launch registry (DESIGN.md "Launcher and worktrees"): a launch provisions a worktree through
// OpenCode, then creates a session there and sends the task. `worktree.create` can take minutes,
// so it runs in a fiber of the runtime, never inside the request; the registry lives in the
// store (so `GET /api/fleet` and the event stream carry it) and in memory only.

export type LaunchStartError =
  | NotACheckoutError
  | OpenCodeInvalidInputError
  | OpenCodeUnavailableError
  | OpenCodeRequestError
  | RejectableError

export type LaunchesOperations = {
  /**
   * Registers the repository with OpenCode (`location.get`) and starts the launch in the
   * background; returns it as registered (`provisioning`).
   */
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

/** One step of a launch, for the failure text and what it leaves behind. */
type Step = 'worktree' | 'session' | 'prompt'

const stepFailure: Readonly<Record<Step, string>> = {
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

export const makeLaunches = (options: LaunchesOptions) =>
  Effect.gen(function* () {
    const store = yield* FleetStore
    const opencode = yield* OpenCode
    const repos = yield* Repos
    const scope = yield* Effect.scope

    const update = (id: string, patch: Partial<Launch>) =>
      Effect.flatMap(Clock.currentTimeMillis, now =>
        store.updateLaunches(list =>
          list.map(launch => (launch.id === id ? { ...launch, ...patch, updatedAt: now } : launch))
        )
      )

    const remove = (id: string) =>
      store.updateLaunches(list => list.filter(launch => launch.id !== id))

    const fail = (launch: Launch, step: Step, error: RejectableError, sessionID?: string) =>
      Effect.andThen(
        Effect.logWarning('Launch failed', launch.id, launch.branch, step, error.message),
        update(launch.id, {
          status: 'failed',
          error: failureText(step, error),
          preserved: preservedText(step, launch.directory, sessionID)
        })
      )

    /** The background part: worktree → session → task → ready (then expiry), or failed. */
    const run = (
      connection: OpenCodeConnection,
      launch: Launch,
      projectID: string,
      name: string
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const created = yield* connection.createWorktree({ projectID, name }).pipe(
          Effect.map(Option.some),
          Effect.catch(error => Effect.as(fail(launch, 'worktree', error), Option.none<string>()))
        )

        if (Option.isNone(created)) return

        const directory = created.value
        const withDirectory: Launch = { ...launch, directory }

        yield* update(launch.id, { status: 'creating-session', directory })

        const session = yield* connection.createSession({ directory, title: launch.task }).pipe(
          Effect.map(Option.some),
          Effect.catch(error =>
            Effect.as(fail(withDirectory, 'session', error), Option.none<{ id: string }>())
          )
        )

        if (Option.isNone(session)) return

        const sessionID = session.value.id

        yield* update(launch.id, { sessionID })

        const prompted = yield* connection.prompt({ sessionID, text: launch.task }).pipe(
          Effect.as(true),
          Effect.catch(error => Effect.as(fail(withDirectory, 'prompt', error, sessionID), false))
        )

        if (!prompted) return

        yield* update(launch.id, { status: 'ready' })
        yield* Effect.logInfo('Launch ready', launch.id, launch.branch, directory, sessionID)
        yield* Effect.sleep(options.readyFor)
        yield* remove(launch.id)
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
        const connection = yield* opencode.connect
        const location = yield* connection.resolveLocation(repo)
        const now = yield* Clock.currentTimeMillis

        const launch: Launch = {
          id: randomUUID(),
          repo,
          repoName: repo.split('/').findLast(part => part !== '') ?? repo,
          branch: input.branch,
          task: input.task.trim(),
          status: 'provisioning',
          startedAt: now,
          updatedAt: now
        }

        yield* store.updateLaunches(list => [...list, launch])
        yield* Effect.logInfo('Launch started', launch.id, launch.branch, repo)
        yield* Effect.forkIn(run(connection, launch, location.projectID, name.value), scope)

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

    const operations: LaunchesOperations = { start, dismiss }

    return operations
  })

/** The registry, with its background launches scoped to the runtime. */
export const LaunchesLive = (options: LaunchesOptions = defaultLaunchesOptions) =>
  Layer.effect(Launches, makeLaunches(options))
