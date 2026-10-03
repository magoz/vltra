import { Effect, Option, Schema } from 'effect'
import { SessionFolderGoneError, SessionNotFinishedError } from '@/lib/data/fleet/errors'
import { folderGone } from '@/lib/data/fleet/folders'
import { snapshotRows } from '@/lib/data/fleet/snapshot'
import { isHandled } from '@/lib/data/fleet/state'
import { FleetStore } from '@/lib/data/fleet/store'
import { SessionNotFoundError } from '@/lib/services/opencode/errors'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection } from '@/lib/services/opencode/service'

// Typed inputs for the web UI's server actions, and the Effects that proxy them to OpenCode.

const Id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200))

export const MarkHandledInput = Schema.Struct({ sessionID: Id })

export type MarkHandledInput = typeof MarkHandledInput.Type

export const ReopenInput = Schema.Struct({ sessionID: Id })

export type ReopenInput = typeof ReopenInput.Type

export const MarkViewedInput = Schema.Struct({ sessionID: Id })

export type MarkViewedInput = typeof MarkViewedInput.Type

export const ReplyPermissionInput = Schema.Struct({
  sessionID: Id,
  requestID: Id,
  decision: Schema.Literals(['once', 'always', 'reject']),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(10_000)))
})

export type ReplyPermissionInput = typeof ReplyPermissionInput.Type

export const FormValue = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Array(Schema.String)
])

export const ReplyFormInput = Schema.Struct({
  sessionID: Id,
  formID: Id,
  answer: Schema.Record(Schema.String, FormValue)
})

export type ReplyFormInput = typeof ReplyFormInput.Type

export const SendPromptInput = Schema.Struct({
  sessionID: Id,
  text: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100_000))
})

export type SendPromptInput = typeof SendPromptInput.Type

export const InterruptSessionInput = Schema.Struct({ sessionID: Id })

export type InterruptSessionInput = typeof InterruptSessionInput.Type

export type MarkHandledOutcome = 'handled' | 'already-handled'

export type ReopenOutcome = 'reopened' | 'not-handled'

export type MarkViewedOutcome = 'marked' | 'already-viewed'

/** Runs `run` against a fresh OpenCode connection (discovered per call). */
export const withConnection = <A, E, R>(
  run: (connection: OpenCodeConnection) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const opencode = yield* OpenCode
    const connection = yield* opencode.connect

    return yield* run(connection)
  })

const readSession = (connection: OpenCodeConnection, sessionID: string) =>
  Effect.flatMap(connection.session(sessionID), found =>
    Option.match(found, {
      onNone: () => Effect.fail(new SessionNotFoundError({ sessionID })),
      onSome: Effect.succeed
    })
  )

/**
 * Mark the latest run of a finished root session handled: `metadata.fleet.handled = idle`, with
 * `idle` read fresh from OpenCode. Rejected unless the watcher sees the root row finished (not
 * running, nothing pending in its subtree); already handled runs are left alone, and so are
 * sessions whose folder is gone (handled by definition; OpenCode cannot write to them).
 */
export const markHandled = (input: MarkHandledInput) =>
  Effect.gen(function* () {
    const view = yield* Effect.flatMap(FleetStore, store => store.view)
    const row = snapshotRows(view.snapshot).find(item => item.id === input.sessionID)

    if (row === undefined) {
      // Not a root row: a subagent (or archived), or a session Fleet does not know.
      return yield* view.model.sessions.has(input.sessionID)
        ? new SessionNotFinishedError({ sessionID: input.sessionID })
        : new SessionNotFoundError({ sessionID: input.sessionID })
    }

    if (row.state !== 'finished' && row.state !== 'handled') {
      return yield* new SessionNotFinishedError({ sessionID: input.sessionID, state: row.state })
    }

    if (yield* folderGone(row.directory)) {
      const outcome: MarkHandledOutcome = 'already-handled'

      return outcome
    }

    return yield* withConnection(connection =>
      Effect.gen(function* () {
        const info = yield* readSession(connection, input.sessionID)

        if (info.idle === undefined || isHandled(info)) {
          const outcome: MarkHandledOutcome = 'already-handled'

          return outcome
        }

        yield* connection.setHandled({ sessionID: input.sessionID, handled: info.idle })

        const outcome: MarkHandledOutcome = 'handled'

        return outcome
      })
    )
  })

/**
 * Undo / Reopen: remove the handled marker, so the latest run is finished again. A session whose
 * folder is gone stays handled (OpenCode cannot write to it): `SessionFolderGoneError`.
 */
export const reopen = (input: ReopenInput) =>
  withConnection(connection =>
    Effect.gen(function* () {
      const info = yield* readSession(connection, input.sessionID)

      if (yield* folderGone(info.directory)) {
        return yield* new SessionFolderGoneError({
          sessionID: input.sessionID,
          directory: info.directory
        })
      }

      if (info.handled === undefined) {
        const outcome: ReopenOutcome = 'not-handled'

        return outcome
      }

      yield* connection.setHandled({ sessionID: input.sessionID, handled: undefined })

      const outcome: ReopenOutcome = 'reopened'

      return outcome
    })
  )

/**
 * OpenCode's own read marker, for its unread dots (opening a session's panel): post the session's
 * current `time.idle` to `POST /api/session/:id/view`. Never changes Fleet state.
 */
export const markViewed = (input: MarkViewedInput) =>
  withConnection(connection =>
    Effect.gen(function* () {
      const { idle, viewed } = yield* readSession(connection, input.sessionID)

      if (idle === undefined || (viewed !== undefined && viewed >= idle)) {
        const outcome: MarkViewedOutcome = 'already-viewed'

        return outcome
      }

      yield* connection.view({ sessionID: input.sessionID, idle })

      const outcome: MarkViewedOutcome = 'marked'

      return outcome
    })
  )

export const replyPermission = (input: ReplyPermissionInput) =>
  withConnection(connection => connection.replyPermission(input))

export const replyForm = (input: ReplyFormInput) =>
  withConnection(connection => connection.replyForm(input))

export const sendPrompt = (input: SendPromptInput) =>
  withConnection(connection => connection.prompt(input))

export const interruptSession = (input: InterruptSessionInput) =>
  withConnection(connection => connection.interrupt(input))
