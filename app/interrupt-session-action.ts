'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { interruptSession, InterruptSessionInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Interrupt a session's active execution. */
export const interruptSessionAction = async (
  input: InterruptSessionInput
): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(InterruptSessionInput)(input)

      yield* interruptSession(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.interrupt-session'))
  )
}
