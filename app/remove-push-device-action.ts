'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { PushDeviceInput, removePushDevice } from '@/lib/data/fleet/push'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Stop notifying a device (this browser, or another from Settings' list). */
export const removePushDeviceAction = async (
  input: PushDeviceInput
): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(PushDeviceInput)(input)

      yield* removePushDevice(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.remove-push-device'))
  )
}
