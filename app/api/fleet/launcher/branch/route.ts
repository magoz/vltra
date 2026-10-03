import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { readJsonRequest } from '@/app/api/fleet/json-request'
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
      const input = yield* Effect.flatMap(readJsonRequest(request), decodeBody)
      const suggestion = yield* Effect.flatMap(suggestBranch(input), encodeSuggestion)

      return Response.json(suggestion, { headers: { 'cache-control': 'no-store' } })
    }).pipe(
      Effect.withSpan('api.fleet.launcher.branch'),
      Effect.catchTags({
        CrossSiteRequestError: () => Effect.succeed(json({ error: 'Request rejected' }, 403)),
        NotJsonError: () => Effect.succeed(json({ error: 'JSON only' }, 415)),
        SchemaError: () => Effect.succeed(json({ error: 'Invalid request: { task }' }, 400))
      })
    )
  )
}
