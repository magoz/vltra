'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionValue, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { savePushDevice, SavePushDeviceInput } from '@/lib/data/fleet/push'
import type { PushDevice } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Turn notifications on for this browser (or refresh its subscription): its device. */
export const savePushDeviceAction = async (
  input: SavePushDeviceInput
): Promise<FleetActionValue<PushDevice>> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(SavePushDeviceInput)(input)

      return FleetActionValue.Success(yield* savePushDevice(decoded))
    }).pipe(toActionResult('action.fleet.save-push-device'))
  )
}
