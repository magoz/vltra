import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { VltraStore } from '@/lib/data/vltra/store'
import { VltraSnapshot } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

const encodeSnapshot = Schema.encodeEffect(VltraSnapshot)

/** Vltra snapshot: projects → worktrees → root session rows, with counts and connection. */
export async function GET() {
  // Reads the in-process watcher, so it must run per request, never at build time.
  await connection()

  return await runVltra(
    Effect.flatMap(VltraStore, store => store.snapshot).pipe(
      Effect.flatMap(encodeSnapshot),
      Effect.map(body => Response.json(body, { headers: { 'cache-control': 'no-store' } })),
      Effect.withSpan('api.vltra.get'),
      Effect.catchTag('SchemaError', error =>
        Effect.logError('api.vltra.get failed', error.message).pipe(
          Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
        )
      )
    )
  )
}
