'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { markHandled, MarkHandledInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Mark a finished root session's latest run handled (`metadata.fleet.handled = idle`). */
export const markHandledAction = async (input: MarkHandledInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(MarkHandledInput)(input)

      yield* markHandled(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.mark-handled'))
  )
}
