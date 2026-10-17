'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { markHandled, MarkHandledInput } from '@/lib/data/vltra/actions'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Mark a finished root session's latest run handled (`metadata.vltra.handled = idle`). */
export const markHandledAction = async (input: MarkHandledInput): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(MarkHandledInput)(input)

      yield* markHandled(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.mark-handled'))
  )
}
