import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { requireSameOrigin } from '@/app/same-origin'
import { suggestBranch, SuggestBranchInput } from '@/lib/data/fleet/launcher'
import { BranchSuggestion } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

const decodeBody = Schema.decodeUnknownEffect(Schema.fromJsonString(SuggestBranchInput))

const encodeSuggestion = Schema.encodeEffect(BranchSuggestion)

const json = (body: Readonly<Record<string, string>>, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * `POST { task }` → `{ branch, source: 'model' | 'fallback' }` (the `suggestBranch` server action,
 * for the terminal plugin). Same rule as every mutation endpoint: JSON only and same-origin, so a
 * non-browser client sends `Origin` with Fleet's own origin. It never fails on OpenCode's side:
 * no model, invalid output or no answer within 4 seconds give the fallback slug.
 */
export async function POST(request: NextRequest) {
  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(request.headers)

      if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
        return json({ error: 'JSON only' }, 415)
      }

      const body = yield* Effect.promise(() => request.text())
      const input = yield* decodeBody(body)
      const suggestion = yield* Effect.flatMap(suggestBranch(input), encodeSuggestion)

      return Response.json(suggestion, { headers: { 'cache-control': 'no-store' } })
    }).pipe(
      Effect.withSpan('api.fleet.launcher.branch'),
      Effect.catchTags({
        CrossSiteRequestError: () => Effect.succeed(json({ error: 'Request rejected' }, 403)),
        SchemaError: () => Effect.succeed(json({ error: 'Invalid request: { task }' }, 400))
      })
    )
  )
}
