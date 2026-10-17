import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { loadUsage } from '@/lib/data/vltra/usage'
import { UsageSummary } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

const encodeSummary = Schema.encodeEffect(UsageSummary)

const noStore = { 'cache-control': 'no-store' }

/** The subscription quotas, one pool per provider (the header's usage line). */
export async function GET() {
  // Reads the usage dashboard at request time.
  await connection()

  return await runVltra(
    loadUsage.pipe(
      Effect.flatMap(encodeSummary),
      Effect.map(body => Response.json(body, { headers: noStore })),
      Effect.withSpan('api.vltra.usage'),
      Effect.catchTags({
        UsageUnavailableError: error =>
          Effect.logWarning('api.vltra.usage unavailable', error.message).pipe(
            Effect.as(Response.json({ error: error.message }, { status: 503, headers: noStore }))
          ),
        SchemaError: error =>
          Effect.logError('api.vltra.usage failed', error.message).pipe(
            Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
          )
      })
    )
  )
}
