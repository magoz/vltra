import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { Stats, StatsQueryParams } from '@/lib/data/vltra/stats'
import type { StatsError, StatsOperations, StatsQuery } from '@/lib/data/vltra/stats'
import type { StatsRangeError } from '@/lib/data/vltra/errors'
import { statsPeriodOf } from '@/lib/data/vltra/stats-period'

const noStore = { 'cache-control': 'no-store' }

const json = (body: Readonly<Record<string, string>>, status: number) =>
  Response.json(body, { status, headers: noStore })

/**
 * A Stats route (`/api/vltra/stats`, `.../hours`): the query (`?range=` or `?from=&to=`, `?tz=`,
 * `?project=`), `read` from the `Stats` service, encoded with `schema`; failures as `{ error }`
 * with a fitting status.
 */
export const statsResponse = <A, I>(
  request: NextRequest,
  operation: string,
  read: (
    stats: StatsOperations,
    query: StatsQuery
  ) => Effect.Effect<A, StatsError | StatsRangeError>,
  schema: Schema.Codec<A, I>
) => {
  const params = request.nextUrl.searchParams

  return Schema.decodeUnknownEffect(StatsQueryParams)({
    timezone: params.get('tz') ?? 'UTC',
    project: params.get('project') ?? undefined
  }).pipe(
    Effect.flatMap(input =>
      Effect.flatMap(Stats, stats =>
        read(stats, {
          period: statsPeriodOf(params),
          timezone: input.timezone,
          project: input.project
        })
      )
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
        )
    })
  )
}
