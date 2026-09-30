import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { FleetStore } from '@/lib/data/fleet/store'
import { FleetSnapshot } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

const encodeSnapshot = Schema.encodeEffect(FleetSnapshot)

/** Fleet snapshot: projects → worktrees → root session rows, with counts and connection. */
export async function GET() {
  // Reads the in-process watcher, so it must run per request, never at build time.
  await connection()

  return await runFleet(
    Effect.flatMap(FleetStore, store => store.snapshot).pipe(
      Effect.flatMap(encodeSnapshot),
      Effect.map(body => Response.json(body, { headers: { 'cache-control': 'no-store' } })),
      Effect.withSpan('api.fleet.get'),
      Effect.catchTag('SchemaError', error =>
        Effect.logError('api.fleet.get failed', error.message).pipe(
          Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
        )
      )
    )
  )
}
