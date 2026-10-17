import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { loadPushSettings } from '@/lib/data/vltra/push'
import { PushSettings } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

const encodeSettings = Schema.encodeEffect(PushSettings)

const noStore = { 'cache-control': 'no-store' }

/** Settings' notifications: the key browsers subscribe with, and the devices that get pushes. */
export async function GET() {
  await connection()

  return await runVltra(
    loadPushSettings.pipe(
      Effect.flatMap(encodeSettings),
      Effect.map(body => Response.json(body, { headers: noStore })),
      Effect.withSpan('api.vltra.notifications'),
      Effect.catchTag('SchemaError', error =>
        Effect.logError('api.vltra.notifications failed', error.message).pipe(
          Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
        )
      )
    )
  )
}
