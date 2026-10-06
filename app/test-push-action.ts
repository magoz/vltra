'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { PushDeviceInput, sendTestPush } from '@/lib/data/fleet/push'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Send a test notification to one device. */
export const testPushAction = async (input: PushDeviceInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(PushDeviceInput)(input)

      yield* sendTestPush(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.test-push'))
  )
}
