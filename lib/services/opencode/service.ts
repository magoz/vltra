import { Context } from 'effect'
import type { Effect, Option, Stream } from 'effect'
import type { OpenCodeSignal } from '@/lib/data/vltra/events'
import type { OpenCodeSnapshot } from '@/lib/data/vltra/model'
import type {
  FileChange,
  InterruptReason,
  ProjectRecord,
  SessionRecord,
  SessionStats,
  Transcript
} from '@/lib/data/vltra/types'
import type {
  OpenCodeInvalidInputError,
  OpenCodeRejectedError,
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'

export type ActionError = OpenCodeRequestError | OpenCodeInvalidInputError | SessionNotFoundError

/** Calls OpenCode may refuse with a message of its own (worktrees, location registration). */
export type RejectableError = ActionError | OpenCodeRejectedError

/** The project OpenCode resolves (registering it if needed) for a directory. */
export type ResolvedLocation = {
  readonly directory: string
  readonly projectID: string
  /** The project's canonical directory (its primary checkout). */
  readonly projectDirectory: string
}

/** One authenticated connection to a discovered OpenCode service. */
export type OpenCodeConnection = {
  readonly url: string
  readonly version: string | undefined
  /**
   * `GET /api/event`, narrowed to Vltra signals. Emits `Connected` once the server-side
   * subscription is open; ends or fails when the server goes away.
   */
  readonly signals: Stream.Stream<OpenCodeSignal, OpenCodeRequestError>
  /** Sessions, active executions, pending permissions/forms, projects, and worktrees. */
  readonly snapshot: Effect.Effect<OpenCodeSnapshot, OpenCodeRequestError>
  readonly session: (
    sessionID: string
  ) => Effect.Effect<Option.Option<SessionRecord>, OpenCodeRequestError>
  readonly worktrees: (
    projectID: string
  ) => Effect.Effect<ReadonlyArray<string>, OpenCodeRequestError>
  /**
   * Set (a number) or remove (`undefined`) Vltra's handled marker, `metadata.vltra.handled`.
   * OpenCode replaces the whole metadata object on write, so this reads the session, changes only
   * that key, and writes everything else back as it was.
   */
  readonly setHandled: (input: {
    readonly sessionID: string
    readonly handled: number | undefined
  }) => Effect.Effect<void, ActionError>
  /**
   * Why the session's latest run was interrupted, from its durable log
   * (`GET /api/experimental/session/:id/log`); none when it did not end interrupted.
   */
  readonly interruptReason: (
    sessionID: string
  ) => Effect.Effect<Option.Option<InterruptReason>, ActionError>
  /** `POST /api/session/:id/view { idle }`. */
  readonly view: (input: {
    readonly sessionID: string
    readonly idle: number
  }) => Effect.Effect<void, ActionError>
  /** `POST /api/session/:id/prompt { text }`: a launch's task. */
  readonly prompt: (input: {
    readonly sessionID: string
    readonly text: string
  }) => Effect.Effect<void, ActionError>
  /**
   * `GET /api/session/:id/message`: the newest `limit` messages as a transcript tail. With
   * `assistantOnly`, only assistant messages are read (enough for the latest answer).
   */
  readonly transcript: (input: {
    readonly sessionID: string
    readonly limit: number
    readonly assistantOnly: boolean
  }) => Effect.Effect<Transcript, ActionError>
  /** `GET /api/session/:id/diff`: files changed by the latest turn (patch text dropped). */
  readonly diff: (input: {
    readonly sessionID: string
  }) => Effect.Effect<ReadonlyArray<FileChange>, ActionError>
  /**
   * `GET /api/location?location[directory]=…`: the directory's project, registered on the way
   * when OpenCode never opened it.
   */
  readonly resolveLocation: (directory: string) => Effect.Effect<ResolvedLocation, RejectableError>
  /**
   * `POST /api/worktree { projectID, name }`: the new worktree's directory. Synchronous on
   * OpenCode's side and may take minutes (the dotfiles plugin provisions the checkout).
   */
  readonly createWorktree: (input: {
    readonly projectID: string
    readonly name: string
  }) => Effect.Effect<string, RejectableError>
  /** `DELETE /api/worktree { projectID, directory, force: false }`; never forced. */
  readonly removeWorktree: (input: {
    readonly projectID: string
    readonly directory: string
  }) => Effect.Effect<void, RejectableError>
  /**
   * `DELETE /api/session/:id`: removes the session for good (messages too). A session already gone
   * counts as removed.
   */
  readonly removeSession: (sessionID: string) => Effect.Effect<void, RejectableError>
  /** `POST /api/session { location: { directory }, title }`. */
  readonly createSession: (input: {
    readonly directory: string
    readonly title: string | undefined
  }) => Effect.Effect<SessionRecord, RejectableError>
  /** `POST /api/experimental/generate { prompt }` with OpenCode's default model: the text. */
  readonly generateText: (prompt: string) => Effect.Effect<string, RejectableError>
  /**
   * `GET /api/experimental/session/stats`: activity in `[from, to)` (from OpenCode's first message
   * when `from` is absent), optionally one project's; days in `timezone`. Tool totals with
   * `summary`, per tool with `detail`, none with `none`. OpenCode refuses an empty range, which is also what "all time" is for a project
   * without messages (2.0.22).
   */
  readonly stats: (input: StatsInput) => Effect.Effect<SessionStats, RejectableError>
  /** `GET /api/project`: every project OpenCode knows. */
  readonly projects: Effect.Effect<ReadonlyArray<ProjectRecord>, OpenCodeRequestError>
}

export type StatsInput = {
  readonly from: number | undefined
  readonly to: number
  readonly projectID: string | undefined
  readonly timezone: string
  readonly tools: 'none' | 'summary' | 'detail'
}

export type OpenCodeOperations = {
  /**
   * Discover the systemd-owned service (never starts one) or use the configured override, and
   * return an authenticated connection. Called per watcher cycle and per action, so a restarted
   * service with a new port or password is picked up.
   */
  readonly connect: Effect.Effect<
    OpenCodeConnection,
    OpenCodeUnavailableError | OpenCodeRequestError
  >
}

export class OpenCode extends Context.Service<OpenCode, OpenCodeOperations>()('@vltra/OpenCode') {}
