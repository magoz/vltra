'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { reopen, ReopenInput } from '@/lib/data/vltra/actions'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Reopen a handled session: remove Vltra's handled marker. */
export const reopenAction = async (input: ReopenInput): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(ReopenInput)(input)

      yield* reopen(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.reopen'))
  )
}
