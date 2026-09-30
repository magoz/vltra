import { Data, Effect } from 'effect'
import type { Schema } from 'effect'
import type { CrossSiteRequestError } from '@/app/same-origin'
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
        OpenCodeUnavailableError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'OpenCode is not reachable' })),
        OpenCodeRequestError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'OpenCode request failed' }))
      })
    )
