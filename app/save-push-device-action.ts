'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionValue, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { savePushDevice, SavePushDeviceInput } from '@/lib/data/vltra/push'
import type { PushDevice } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Turn notifications on for this browser (or refresh its subscription): its device. */
export const savePushDeviceAction = async (
  input: SavePushDeviceInput
): Promise<VltraActionValue<PushDevice>> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(SavePushDeviceInput)(input)

      return VltraActionValue.Success(yield* savePushDevice(decoded))
    }).pipe(toActionResult('action.vltra.save-push-device'))
  )
}
