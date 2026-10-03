import { Data, Effect } from 'effect'
import type { Schema } from 'effect'
import type { CrossSiteRequestError } from '@/app/same-origin'
import type {
  LaunchInProgressError,
  LaunchNotFoundError,
  NotACheckoutError,
  RetireRefusedError,
  SessionFolderGoneError,
  SessionNotFinishedError
} from '@/lib/data/fleet/errors'
import type {
  OpenCodeInvalidInputError,
  OpenCodeRejectedError,
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

/** The failure case of every action result. */
export type FleetActionFailure = Extract<FleetActionResult, { readonly _tag: 'Error' }>

/** An action result that carries a value on success (launch id, session id, suggestion). */
export type FleetActionValue<A> =
  | FleetActionFailure
  | { readonly _tag: 'Success'; readonly value: A }

interface FleetActionValueDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: FleetActionValue<this['A']>
}

const FleetActionValueCases = Data.taggedEnum<FleetActionValueDefinition>()

export const FleetActionValue = {
  Success: <A>(value: A): FleetActionValue<A> => {
    const { _tag } = FleetActionValueCases.Success({ value })

    return { _tag, value }
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
  | OpenCodeRejectedError
  | NotACheckoutError
  | RetireRefusedError
  | LaunchNotFoundError
  | LaunchInProgressError

/** User-facing words for the OpenCode calls that write; reads keep the generic message. */
const requestFailures = new Map([
  ['session.update', 'OpenCode could not save the handled marker'],
  ['session.prompt', 'OpenCode could not send the prompt'],
  ['session.interrupt', 'OpenCode could not interrupt the session'],
  ['permission.reply', 'OpenCode could not record the reply'],
  ['session.form.reply', 'OpenCode could not record the answer'],
  ['location.get', 'OpenCode could not open the repository'],
  ['session.create', 'OpenCode could not create the session'],
  ['worktree.remove', 'OpenCode could not remove the worktree']
])

/**
 * Shared tail of every Fleet server action: report unexpected failures, then map expected ones
 * to user-safe messages.
 */
export const toActionResult =
  (operation: string) =>
  <A, R>(
    effect: Effect.Effect<A, FleetActionError, R>
  ): Effect.Effect<A | FleetActionFailure, never, R> =>
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
        // OpenCode's own words (sanitized), e.g. the worktree plugin's refusals.
        OpenCodeRejectedError: error =>
          Effect.succeed(FleetActionResult.Error({ message: error.message })),
        NotACheckoutError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'Not a git checkout on Box' })),
        RetireRefusedError: error =>
          Effect.succeed(FleetActionResult.Error({ message: error.reason })),
        LaunchNotFoundError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'That launch is gone' })),
        LaunchInProgressError: () =>
          Effect.succeed(FleetActionResult.Error({ message: 'The launch is still running' })),
        OpenCodeRequestError: error =>
          Effect.succeed(
            FleetActionResult.Error({
              message: requestFailures.get(error.operation) ?? 'OpenCode request failed'
            })
          )
      })
    )
