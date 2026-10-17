import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { toReadResponse } from '@/app/api/vltra/sessions/session-read-response'
import { SessionSummaries, SessionSummaryInput } from '@/lib/data/vltra/session-detail'
import { SessionSummary } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/**
 * A finished run's answer excerpt and change totals, keyed by the run's `idle` time. Served from
 * the runtime's summary cache; the browser may keep it too, since `idle` pins the run.
 */
export async function GET(request: NextRequest, context: Context) {
  await connection()

  const { id } = await context.params

  return await runVltra(
    Schema.decodeUnknownEffect(SessionSummaryInput)({
      sessionID: id,
      idle: request.nextUrl.searchParams.get('idle') ?? ''
    }).pipe(
      Effect.flatMap(input => Effect.flatMap(SessionSummaries, summaries => summaries.get(input))),
      Effect.flatMap(Schema.encodeEffect(SessionSummary)),
      toReadResponse('api.vltra.session.summary', 'private, max-age=3600')
    )
  )
}
