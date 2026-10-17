'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { PushDeviceInput, removePushDevice } from '@/lib/data/vltra/push'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Stop notifying a device (this browser, or another from Settings' list). */
export const removePushDeviceAction = async (
  input: PushDeviceInput
): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(PushDeviceInput)(input)

      yield* removePushDevice(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.remove-push-device'))
  )
}
