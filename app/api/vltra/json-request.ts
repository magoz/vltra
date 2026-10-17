import { Effect, Schema } from 'effect'
import { requireSameOrigin } from '@/app/same-origin'

/** A mutating route got a body that is not `application/json`. */
export class NotJsonError extends Schema.TaggedError<NotJsonError>()('NotJsonError', {
  contentType: Schema.String
}) {}

/**
 * The guard of every JSON POST route (the terminal plugin's mutations, branch suggestions): the
 * same-origin check of the server actions (a non-browser client sends `Origin` with Vltra's own
 * origin), then JSON only. Gives the raw body for the route's own Schema.
 */
export const readJsonRequest = (request: Request) =>
  Effect.gen(function* () {
    yield* requireSameOrigin(request.headers)

    const contentType = request.headers.get('content-type') ?? ''

    if (!contentType.startsWith('application/json')) {
      return yield* new NotJsonError({ contentType })
    }

    return yield* Effect.promise(() => request.text())
  })
