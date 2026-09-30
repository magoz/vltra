'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { markSeen, MarkSeenInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Mark a finished session seen (OpenCode `POST /api/session/:id/view`). */
export const markSeenAction = async (input: MarkSeenInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(MarkSeenInput)(input)

      yield* markSeen(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.mark-seen'))
  )
}
