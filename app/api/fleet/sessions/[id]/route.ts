import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { toReadResponse } from '@/app/api/fleet/sessions/session-read-response'
import { loadSessionDetail, SessionDetailInput } from '@/lib/data/fleet/session-detail'
import { SessionDetail } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/** Session panel data: the transcript tail and the latest turn's changed files (bounded). */
export async function GET(_request: Request, context: Context) {
  await connection()

  const { id } = await context.params

  return await runFleet(
    Schema.decodeUnknownEffect(SessionDetailInput)({ sessionID: id }).pipe(
      Effect.flatMap(loadSessionDetail),
      Effect.flatMap(Schema.encodeEffect(SessionDetail)),
      toReadResponse('api.fleet.session.get', 'no-store')
    )
  )
}
