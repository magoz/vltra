import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { StatsQueryParams } from '@/lib/data/vltra/stats'
import type { StatsError, StatsQuery } from '@/lib/data/vltra/stats'
import type { StatsRangeError } from '@/lib/data/vltra/errors'
import { statsPeriodOf } from '@/lib/data/vltra/stats-period'
import type { GitHubUnavailableError } from '@/lib/services/github/service'

const noStore = { 'cache-control': 'no-store' }

const json = (body: Readonly<Record<string, string>>, status: number) =>
  Response.json(body, { status, headers: noStore })

/** What a Stats route's read can fail with. */
export type StatsReadError = StatsError | StatsRangeError | GitHubUnavailableError

/**
 * A Stats route (`/api/vltra/stats`, `.../hours`, ...): the query (`?range=` or `?from=&to=`,
 * `?tz=`, `?project=`), `read`, encoded with `schema`; failures as `{ error }` with a fitting
 * status.
 */
export const statsResponse = <A, I, R>(
  request: NextRequest,
  operation: string,
  read: (query: StatsQuery) => Effect.Effect<A, StatsReadError, R>,
  schema: Schema.Codec<A, I>
) => {
  const params = request.nextUrl.searchParams

  return Schema.decodeUnknownEffect(StatsQueryParams)({
    timezone: params.get('tz') ?? 'UTC',
    project: params.get('project') ?? undefined
  }).pipe(
    Effect.flatMap(input =>
      read({ period: statsPeriodOf(params), timezone: input.timezone, project: input.project })
    ),
    Effect.flatMap(Schema.encodeEffect(schema)),
    Effect.map(body => Response.json(body, { headers: noStore })),
    Effect.withSpan(operation),
    Effect.catchTags({
      SchemaError: () => Effect.succeed(json({ error: 'Invalid request' }, 400)),
      StatsRangeError: () => Effect.succeed(json({ error: 'Invalid range or time zone' }, 400)),
      OpenCodeInvalidInputError: () => Effect.succeed(json({ error: 'Invalid project' }, 400)),
      SessionNotFoundError: () => Effect.succeed(json({ error: 'Not found' }, 404)),
      OpenCodeRejectedError: error => Effect.succeed(json({ error: error.message }, 400)),
      OpenCodeUnavailableError: () =>
        Effect.succeed(json({ error: 'OpenCode is not reachable' }, 503)),
      OpenCodeRequestError: error =>
        Effect.logWarning(`${operation} failed`, error.operation, error.message).pipe(
          Effect.as(json({ error: 'OpenCode request failed' }, 502))
        ),
      GitHubUnavailableError: error =>
        Effect.logWarning(`${operation} unavailable`, error.message).pipe(
          Effect.as(json({ error: error.message }, 503))
        )
    })
  )
}
