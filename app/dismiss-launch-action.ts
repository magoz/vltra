'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { DismissLaunchInput } from '@/lib/data/vltra/launcher'
import { Launches } from '@/lib/data/vltra/launches'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Remove a failed (or ready) launch from the list. */
export const dismissLaunchAction = async (
  input: DismissLaunchInput
): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(DismissLaunchInput)(input)

      yield* Effect.flatMap(Launches, launches => launches.dismiss(decoded.id))

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.dismiss-launch'))
  )
}
