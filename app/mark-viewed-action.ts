'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { markViewed, MarkViewedInput } from '@/lib/data/vltra/actions'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Mark a session viewed in OpenCode (`POST /api/session/:id/view`), for its unread dots. */
export const markViewedAction = async (input: MarkViewedInput): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(MarkViewedInput)(input)

      yield* markViewed(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.mark-viewed'))
  )
}
