import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { loadPushSettings } from '@/lib/data/fleet/push'
import { PushSettings } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

const encodeSettings = Schema.encodeEffect(PushSettings)

const noStore = { 'cache-control': 'no-store' }

/** Settings' notifications: the key browsers subscribe with, and the devices that get pushes. */
export async function GET() {
  await connection()

  return await runFleet(
    loadPushSettings.pipe(
      Effect.flatMap(encodeSettings),
      Effect.map(body => Response.json(body, { headers: noStore })),
      Effect.withSpan('api.fleet.notifications'),
      Effect.catchTag('SchemaError', error =>
        Effect.logError('api.fleet.notifications failed', error.message).pipe(
          Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
        )
      )
    )
  )
}
