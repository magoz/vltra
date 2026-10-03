import { Context } from 'effect'
import type { Effect, Option, Stream } from 'effect'
import type { OpenCodeSignal } from '@/lib/data/fleet/events'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import type { FileChange, InterruptReason, SessionRecord, Transcript } from '@/lib/data/fleet/types'
import type {
  OpenCodeInvalidInputError,
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'

export type PermissionDecision = 'once' | 'always' | 'reject'

/** A form answer value, as accepted by OpenCode's `Form.Answer`. */
export type FormValue = string | number | boolean | ReadonlyArray<string>

export type ActionError = OpenCodeRequestError | OpenCodeInvalidInputError | SessionNotFoundError

/** One authenticated connection to a discovered OpenCode service. */
export type OpenCodeConnection = {
  readonly url: string
  readonly version: string | undefined
  /**
   * `GET /api/event`, narrowed to Fleet signals. Emits `Connected` once the server-side
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
   * Set (a number) or remove (`undefined`) Fleet's handled marker, `metadata.fleet.handled`.
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
  readonly replyPermission: (input: {
    readonly sessionID: string
    readonly requestID: string
    readonly decision: PermissionDecision
    readonly message?: string | undefined
  }) => Effect.Effect<void, ActionError>
  readonly replyForm: (input: {
    readonly sessionID: string
    readonly formID: string
    readonly answer: Readonly<Record<string, FormValue>>
  }) => Effect.Effect<void, ActionError>
  readonly prompt: (input: {
    readonly sessionID: string
    readonly text: string
  }) => Effect.Effect<void, ActionError>
  readonly interrupt: (input: { readonly sessionID: string }) => Effect.Effect<boolean, ActionError>
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

export class OpenCode extends Context.Service<OpenCode, OpenCodeOperations>()('@fleet/OpenCode') {}
