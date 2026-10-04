import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { loadUsage } from '@/lib/data/fleet/usage'
import { UsageSummary } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

const encodeSummary = Schema.encodeEffect(UsageSummary)

const noStore = { 'cache-control': 'no-store' }

/** The subscription quotas, one pool per provider (the header's usage line). */
export async function GET() {
  // Reads the usage dashboard at request time.
  await connection()

  return await runFleet(
    loadUsage.pipe(
      Effect.flatMap(encodeSummary),
      Effect.map(body => Response.json(body, { headers: noStore })),
      Effect.withSpan('api.fleet.usage'),
      Effect.catchTags({
        UsageUnavailableError: error =>
          Effect.logWarning('api.fleet.usage unavailable', error.message).pipe(
            Effect.as(Response.json({ error: error.message }, { status: 503, headers: noStore }))
          ),
        SchemaError: error =>
          Effect.logError('api.fleet.usage failed', error.message).pipe(
            Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
          )
      })
    )
  )
}
