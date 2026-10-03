'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { DismissLaunchInput } from '@/lib/data/fleet/launcher'
import { Launches } from '@/lib/data/fleet/launches'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Remove a failed (or ready) launch from the list. */
export const dismissLaunchAction = async (
  input: DismissLaunchInput
): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(DismissLaunchInput)(input)

      yield* Effect.flatMap(Launches, launches => launches.dismiss(decoded.id))

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.dismiss-launch'))
  )
}
