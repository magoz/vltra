import { Effect } from 'effect'
import type { Schema } from 'effect'
import type { SessionReadError } from '@/lib/data/fleet/session-detail'

const json = (body: Readonly<Record<string, string>>, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * Shared tail of the session read routes: a JSON body on success, and a user-safe error with a
 * fitting status otherwise. Unexpected failures are logged.
 */
export const toReadResponse =
  (operation: string, cacheControl: string) =>
  <A, R>(
    effect: Effect.Effect<A, SessionReadError | Schema.SchemaError, R>
  ): Effect.Effect<Response, never, R> =>
    effect.pipe(
      Effect.map(body => Response.json(body, { headers: { 'cache-control': cacheControl } })),
      Effect.withSpan(operation),
      Effect.catchTags({
        SchemaError: () => Effect.succeed(json({ error: 'Invalid request' }, 400)),
        OpenCodeInvalidInputError: () => Effect.succeed(json({ error: 'Invalid session id' }, 400)),
        SessionNotFoundError: () => Effect.succeed(json({ error: 'Session not found' }, 404)),
        OpenCodeUnavailableError: () =>
          Effect.succeed(json({ error: 'OpenCode is not reachable' }, 503)),
        OpenCodeRequestError: error =>
          Effect.logWarning(`${operation} failed`, error.operation, error.message).pipe(
            Effect.as(json({ error: 'OpenCode request failed' }, 502))
          )
      })
    )
