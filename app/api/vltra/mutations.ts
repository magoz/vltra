import { Effect, Match, Schema } from 'effect'
import { readJsonRequest } from '@/app/api/vltra/json-request'
import type { NotJsonError } from '@/app/api/vltra/json-request'
import { failureMessage } from '@/app/vltra-action-result'
import type { VltraActionError } from '@/app/vltra-action-result'
import { markHandled, MarkHandledInput, reopen, ReopenInput } from '@/lib/data/vltra/actions'
import {
  DismissLaunchInput,
  LaunchInput,
  openCheckout,
  OpenCheckoutInput
} from '@/lib/data/vltra/launcher'
import { Launches } from '@/lib/data/vltra/launches'
import { EmptyRequest } from '@/lib/data/vltra/types'
import type {
  ApiFailure,
  HandledResult,
  LaunchDismissed,
  LaunchStarted,
  OpenedCheckout,
  ReopenResult
} from '@/lib/data/vltra/types'

// The terminal plugin's mutations (DESIGN.md "Vltra API"): the web's server actions as JSON
// routes, with the same Effects, input Schemas, same-origin check and messages. Each takes the
// request (and path id) and answers a `Response`; the route files only run them on the runtime.

type MutationError = VltraActionError | NotJsonError

/** What a mutation route answers: its result, or the failure. */
type MutationBody =
  | ApiFailure
  | HandledResult
  | ReopenResult
  | LaunchStarted
  | LaunchDismissed
  | OpenedCheckout

const json = (body: MutationBody, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** HTTP status for an expected failure (its message is the server action's). */
export const failureStatus = (error: VltraActionError): number =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      CrossSiteRequestError: () => 403,
      SchemaError: () => 400,
      OpenCodeInvalidInputError: () => 400,
      NotACheckoutError: () => 400,
      SessionNotFoundError: () => 404,
      LaunchNotFoundError: () => 404,
      SessionNotFinishedError: () => 409,
      SessionFolderGoneError: () => 409,
      LaunchInProgressError: () => 409,
      RetireRefusedError: () => 409,
      ProjectBusyError: () => 409,
      OpenCodeRejectedError: () => 409,
      OpenCodeRequestError: () => 502,
      OpenCodeUnavailableError: () => 503,
      PushDeviceNotFoundError: () => 404,
      PushSendError: () => 502,
      PushStoreError: () => 503,
      WatcherRefusedError: () => 400,
      WatcherUnavailableError: () => 503
    })
  )

/**
 * Shared tail of the mutation routes: `200` with the result, else `{ error }` with the fitting
 * status (`415` for a body that is not JSON). Failures are logged like the server actions'.
 */
export const toMutationResponse =
  (operation: string) =>
  <A extends MutationBody, R>(
    effect: Effect.Effect<A, MutationError, R>
  ): Effect.Effect<Response, never, R> =>
    effect.pipe(
      Effect.map(body => json(body, 200)),
      Effect.withSpan(operation),
      Effect.tapError(error => Effect.logWarning(`${operation} failed`, error._tag, error.message)),
      Effect.catchTag('NotJsonError', () => {
        const body: ApiFailure = { error: 'JSON only' }

        return Effect.succeed(json(body, 415))
      }),
      Effect.catch(error => {
        const body: ApiFailure = { error: failureMessage(error) }

        return Effect.succeed(json(body, failureStatus(error)))
      })
    )

/** Guard + JSON body decoded with `schema`. */
const readBody = <S extends Schema.Top>(request: Request, schema: S) =>
  Effect.flatMap(
    readJsonRequest(request),
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))
  )

/** `POST /api/vltra/sessions/:id/handled` `{}` (the `markHandled` action). */
export const markHandledResponse = (request: Request, sessionID: string) =>
  Effect.gen(function* () {
    yield* readBody(request, EmptyRequest)

    const input = yield* Schema.decodeUnknownEffect(MarkHandledInput)({ sessionID })
    const result: HandledResult = { sessionID: input.sessionID, outcome: yield* markHandled(input) }

    return result
  }).pipe(toMutationResponse('api.vltra.session.handled'))

/** `POST /api/vltra/sessions/:id/reopen` `{}` (the `reopen` action, also Undo). */
export const reopenResponse = (request: Request, sessionID: string) =>
  Effect.gen(function* () {
    yield* readBody(request, EmptyRequest)

    const input = yield* Schema.decodeUnknownEffect(ReopenInput)({ sessionID })
    const result: ReopenResult = { sessionID: input.sessionID, outcome: yield* reopen(input) }

    return result
  }).pipe(toMutationResponse('api.vltra.session.reopen'))

/**
 * `POST /api/vltra/launches` `{ repoDir, branch, task }` (the `launch` action): answers once the
 * launch is registered; its progress reaches clients in `launches` (snapshot and events).
 */
export const launchResponse = (request: Request) =>
  Effect.gen(function* () {
    const input = yield* readBody(request, LaunchInput)
    const launch = yield* Effect.flatMap(Launches, launches => launches.start(input))
    const result: LaunchStarted = { launchID: launch.id }

    return result
  }).pipe(toMutationResponse('api.vltra.launch'))

/** `POST /api/vltra/launches/:id/dismiss` `{}` (the `dismissLaunch` action). */
export const dismissLaunchResponse = (request: Request, id: string) =>
  Effect.gen(function* () {
    yield* readBody(request, EmptyRequest)

    const input = yield* Schema.decodeUnknownEffect(DismissLaunchInput)({ id })

    yield* Effect.flatMap(Launches, launches => launches.dismiss(input.id))

    const result: LaunchDismissed = { launchID: input.id }

    return result
  }).pipe(toMutationResponse('api.vltra.launch.dismiss'))

/** `POST /api/vltra/checkouts/open` `{ directory }` (the `openCheckout` action). */
export const openCheckoutResponse = (request: Request) =>
  Effect.gen(function* () {
    const input = yield* readBody(request, OpenCheckoutInput)
    const result: OpenedCheckout = yield* openCheckout(input)

    return result
  }).pipe(toMutationResponse('api.vltra.checkout.open'))
