import { Data, Effect, Match } from 'effect'
import type { Schema } from 'effect'
import type { CrossSiteRequestError } from '@/app/same-origin'
import type {
  LaunchInProgressError,
  LaunchNotFoundError,
  NotACheckoutError,
  ProjectBusyError,
  RetireRefusedError,
  SessionFolderGoneError,
  SessionNotFinishedError
} from '@/lib/data/vltra/errors'
import type {
  OpenCodeInvalidInputError,
  OpenCodeRejectedError,
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'
import type {
  PushDeviceNotFoundError,
  PushSendError,
  PushStoreError
} from '@/lib/services/push/service'
import type { WatcherRefusedError, WatcherUnavailableError } from '@/lib/services/watcher/service'

// Not a validation boundary. Construct the owner case, then project to a plain, tag-first object
// for the action wire.
export type VltraActionResult =
  | { readonly _tag: 'Error'; readonly message: string }
  | { readonly _tag: 'Success' }

const VltraActionResultCases = Data.taggedEnum<VltraActionResult>()

export const VltraActionResult = {
  Error: (fields: Parameters<typeof VltraActionResultCases.Error>[0]) => {
    const { _tag, ...payload } = VltraActionResultCases.Error(fields)

    return { _tag, ...payload }
  },
  Success: () => {
    const { _tag } = VltraActionResultCases.Success()

    return { _tag }
  }
}

/** The failure case of every action result. */
export type VltraActionFailure = Extract<VltraActionResult, { readonly _tag: 'Error' }>

/** An action result that carries a value on success (launch id, session id, suggestion). */
export type VltraActionValue<A> =
  | VltraActionFailure
  | { readonly _tag: 'Success'; readonly value: A }

interface VltraActionValueDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: VltraActionValue<this['A']>
}

const VltraActionValueCases = Data.taggedEnum<VltraActionValueDefinition>()

export const VltraActionValue = {
  Success: <A>(value: A): VltraActionValue<A> => {
    const { _tag } = VltraActionValueCases.Success({ value })

    return { _tag, value }
  }
}

export type VltraActionError =
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
  | ProjectBusyError
  | LaunchNotFoundError
  | LaunchInProgressError
  | PushStoreError
  | PushDeviceNotFoundError
  | PushSendError
  | WatcherUnavailableError
  | WatcherRefusedError

/** User-facing words for the OpenCode calls that write; reads keep the generic message. */
const requestFailures = new Map([
  ['session.update', 'OpenCode could not mark it done'],
  ['session.prompt', 'OpenCode could not send the prompt'],
  ['session.interrupt', 'OpenCode could not interrupt the session'],
  ['permission.reply', 'OpenCode could not record the reply'],
  ['session.form.reply', 'OpenCode could not record the answer'],
  ['location.get', 'OpenCode could not open the repository'],
  ['session.create', 'OpenCode could not create the session'],
  ['worktree.remove', 'OpenCode could not remove the worktree'],
  ['session.remove', 'OpenCode could not delete a session']
])

/**
 * The user-safe message for an expected failure: the server actions' `Error` message and the
 * JSON routes' `{ error }`.
 */
export const failureMessage = (error: VltraActionError): string =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      CrossSiteRequestError: () => 'Request rejected',
      SchemaError: () => 'Invalid input',
      OpenCodeInvalidInputError: invalid => invalid.message,
      SessionNotFoundError: () => 'Session not found',
      SessionNotFinishedError: () => 'Only a finished session can be marked done',
      SessionFolderGoneError: () => "The session's folder no longer exists",
      OpenCodeUnavailableError: () => 'OpenCode is not reachable',
      // OpenCode's own words (sanitized), e.g. the worktree plugin's refusals.
      OpenCodeRejectedError: rejected => rejected.message,
      NotACheckoutError: () => 'Not a git checkout on Box',
      RetireRefusedError: refused => refused.reason,
      ProjectBusyError: ({ busy }) =>
        `${busy} ${busy === 1 ? 'session there is' : 'sessions there are'} working or blocked`,
      LaunchNotFoundError: () => 'That launch is gone',
      LaunchInProgressError: () => 'The launch is still running',
      OpenCodeRequestError: failed =>
        requestFailures.get(failed.operation) ?? 'OpenCode request failed',
      PushStoreError: () => 'Vltra could not save the notification settings',
      PushDeviceNotFoundError: () => 'This device no longer gets notifications',
      PushSendError: failed => `The push service refused: ${failed.message}`,
      WatcherUnavailableError: () => 'Watcher is not running, so nothing can be launched',
      // Watcher's own words, e.g. an invalid branch.
      WatcherRefusedError: refused => refused.message
    })
  )

/**
 * Shared tail of every Vltra server action: report unexpected failures, then map expected ones
 * to user-safe messages.
 */
export const toActionResult =
  (operation: string) =>
  <A, R>(
    effect: Effect.Effect<A, VltraActionError, R>
  ): Effect.Effect<A | VltraActionFailure, never, R> =>
    effect.pipe(
      Effect.withSpan(operation),
      Effect.tapError(error => Effect.logWarning(`${operation} failed`, error._tag, error.message)),
      Effect.catch(error =>
        Effect.succeed(VltraActionResult.Error({ message: failureMessage(error) }))
      )
    )
