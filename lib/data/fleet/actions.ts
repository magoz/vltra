import { Effect, Option, Schema } from 'effect'
import { SessionNotFoundError } from '@/lib/services/opencode/errors'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection } from '@/lib/services/opencode/service'

// Typed inputs for the web UI's server actions, and the Effects that proxy them to OpenCode.

const Id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200))

export const MarkSeenInput = Schema.Struct({ sessionID: Id })

export type MarkSeenInput = typeof MarkSeenInput.Type

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

export type MarkSeenOutcome = 'marked' | 'already-seen'

const withConnection = <A, E>(run: (connection: OpenCodeConnection) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const opencode = yield* OpenCode
    const connection = yield* opencode.connect

    return yield* run(connection)
  })

/**
 * "Mark seen" is OpenCode's own: read the session's current `time.idle` and post it to
 * `POST /api/session/:id/view`. OpenCode only advances `viewed` up to the idle it was shown.
 */
export const markSeen = (input: MarkSeenInput) =>
  withConnection(connection =>
    Effect.gen(function* () {
      const found = yield* connection.session(input.sessionID)

      if (Option.isNone(found)) {
        return yield* new SessionNotFoundError({ sessionID: input.sessionID })
      }

      const { idle, viewed } = found.value

      if (idle === undefined || (viewed !== undefined && viewed >= idle)) {
        const outcome: MarkSeenOutcome = 'already-seen'

        return outcome
      }

      yield* connection.view({ sessionID: input.sessionID, idle })

      const outcome: MarkSeenOutcome = 'marked'

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
