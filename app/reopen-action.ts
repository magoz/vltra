'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { reopen, ReopenInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Reopen a handled session: remove Fleet's handled marker. */
export const reopenAction = async (input: ReopenInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(ReopenInput)(input)

      yield* reopen(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.reopen'))
  )
}
