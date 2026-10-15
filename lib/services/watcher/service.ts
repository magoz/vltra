import { Context, Schema } from 'effect'
import type { Effect, Option } from 'effect'

/** A run as Watcher's API shows it (`RunView`): one launch, from claim to launched or failed. */
export const WatcherRun = Schema.Struct({
  id: Schema.String,
  /** `manual` for launches asked for directly (Fleet's), else the watch's id. */
  watch: Schema.String,
  key: Schema.String,
  status: Schema.Literals(['launching', 'launched', 'failed']),
  /** Failed runs: the step (`location`, `worktree`, `session`, `prompt`, `render`) and why. */
  step: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  repo: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  /** The worktree, once it exists. */
  directory: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number
})

export type WatcherRun = typeof WatcherRun.Type

/** Watcher's daemon is not running, or answered something Fleet cannot read. */
export class WatcherUnavailableError extends Schema.TaggedError<WatcherUnavailableError>()(
  'WatcherUnavailableError',
  { message: Schema.String }
) {}

/** Watcher refused the launch (its own words, e.g. an invalid branch). */
export class WatcherRefusedError extends Schema.TaggedError<WatcherRefusedError>()(
  'WatcherRefusedError',
  { message: Schema.String }
) {}

export type LaunchRequest = {
  readonly repo: string
  readonly branch: string
  readonly prompt: string
}

export type WatcherOperations = {
  /** Starts a launch (`POST /launches`): no watch, no limits, no guardrails. */
  readonly launch: (
    request: LaunchRequest
  ) => Effect.Effect<WatcherRun, WatcherUnavailableError | WatcherRefusedError>
  /** One run, or none when Watcher does not know it. */
  readonly run: (id: string) => Effect.Effect<Option.Option<WatcherRun>, WatcherUnavailableError>
  /** Fleet's launches still running (after a Fleet restart). */
  readonly launching: Effect.Effect<ReadonlyArray<WatcherRun>, WatcherUnavailableError>
}

/**
 * Watcher (`~/dev/repos/watcher`), the daemon that runs launches on this machine: they survive a
 * Fleet restart, drain on Watcher's own restarts and are recovered after a crash. Reached over its
 * unix socket.
 */
export class Watcher extends Context.Service<Watcher, WatcherOperations>()('@fleet/Watcher') {}
