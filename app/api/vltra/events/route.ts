import { Effect, Schema, Stream } from 'effect'
import { connection } from 'next/server'
import { VltraStore } from '@/lib/data/vltra/store'
import { VltraChange } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

const encodeChange = Schema.encodeEffect(VltraChange)

const heartbeat = Stream.tick('15 seconds').pipe(Stream.map(() => ': heartbeat\n\n'))

/**
 * SSE: `vltra.changed` events with changed root rows. The first event (`initial: true`) is sent
 * once this stream is subscribed; clients load `GET /api/vltra` after it (and after every
 * reconnect), so no change can fall between the snapshot and the stream.
 */
export async function GET() {
  await connection()

  const body = await runVltra(
    Effect.gen(function* () {
      const store = yield* VltraStore
      const context = yield* Effect.context<never>()

      const events = store.changes.pipe(
        Stream.mapEffect(change => encodeChange(change)),
        Stream.map(change => `event: vltra.changed\ndata: ${JSON.stringify(change)}\n\n`),
        Stream.catchTag('SchemaError', error =>
          Stream.fromEffect(Effect.logError('api.vltra.events encode failed', error.message)).pipe(
            Stream.drain
          )
        )
      )

      return Stream.merge(events, heartbeat, { haltStrategy: 'left' }).pipe(
        Stream.encodeText,
        Stream.toReadableStreamWith(context)
      )
    }).pipe(Effect.withSpan('api.vltra.events'))
  )

  return new Response(body, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      'content-type': 'text/event-stream',
      'x-accel-buffering': 'no',
      connection: 'keep-alive'
    }
  })
}
