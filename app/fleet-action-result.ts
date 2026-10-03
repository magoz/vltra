import { Data, Effect } from 'effect'
import type { Schema } from 'effect'
import type { CrossSiteRequestError } from '@/app/same-origin'
import type { SessionFolderGoneError, SessionNotFinishedError } from '@/lib/data/fleet/errors'
import type {
  OpenCodeInvalidInputError,
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'

// Not a validation boundary. Construct the owner case, then project to a plain, tag-first object
// for the action wire.
export type FleetActionResult =
  | { readonly _tag: 'Error'; readonly message: string }
  | { readonly _tag: 'Success' }

const FleetActionResultCases = Data.taggedEnum<FleetActionResult>()

export const FleetActionResult = {
  Error: (fields: Parameters<typeof FleetActionResultCases.Error>[0]) => {
    const { _tag, ...payload } = FleetActionResultCases.Error(fields)

    return { _tag, ...payload }
  },
  Success: () => {
    const { _tag } = FleetActionResultCases.Success()

    return { _tag }
  }
}

export type FleetActionError =
  | CrossSiteRequestError
  | Schema.SchemaError
  | OpenCodeInvalidInputError
  | OpenCodeRequestError
  | OpenCodeUnavailableError
  | SessionNotFoundError
  | SessionNotFinishedError
  | SessionFolderGoneError

/** User-facing words for the OpenCode calls that write; reads keep the generic message. */
const requestFailures = new Map([
  ['session.update', 'OpenCode could not save the handled marker'],
  ['session.prompt', 'OpenCode could not send the prompt'],
  ['session.interrupt', 'OpenCode could not interrupt the session'],
  ['permission.reply', 'OpenCode could not record the reply'],
  ['session.form.reply', 'OpenCode could not record the answer']
])

/**
 * Shared tail of every Fleet server action: report unexpected failures, then map expected ones
 * to user-safe messages.
 */
export const toActionResult =
  (operation: string) =>
  <R>(
    effect: Effect.Effect<FleetActionResult, FleetActionError, R>
  ): Effect.Effect<FleetActionResult, never, R> =>
    effect.pipe(
      Effect.withSpan(operation),
      Effect.tapError(error => Effect.logWarning(`${operation} failed`, error._tag, error.message)),
      Effect.catchTags({
        CrossSiteRequestError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'Request rejected' })),
        SchemaError: () => Effect.succeed(FleetActionResult.Error({ message: 'Invalid input' })),
        OpenCodeInvalidInputError: error =>
          Effect.succeed(FleetActionResult.Error({ message: error.message })),
        SessionNotFoundError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'Session not found' })),
        SessionNotFinishedError: () =>
          Effect.succeed(
            FleetActionResult.Error({ message: 'Only a finished session can be marked handled' })
          ),
        SessionFolderGoneError: () =>
          Effect.succeed(
            FleetActionResult.Error({ message: "The session's folder no longer exists" })
          ),
        OpenCodeUnavailableError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'OpenCode is not reachable' })),
        OpenCodeRequestError: error =>
          Effect.succeed(
            FleetActionResult.Error({
              message: requestFailures.get(error.operation) ?? 'OpenCode request failed'
            })
          )
      })
    )
