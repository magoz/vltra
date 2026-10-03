'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { markViewed, MarkViewedInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Mark a session viewed in OpenCode (`POST /api/session/:id/view`), for its unread dots. */
export const markViewedAction = async (input: MarkViewedInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(MarkViewedInput)(input)

      yield* markViewed(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.mark-viewed'))
  )
}
