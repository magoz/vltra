'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { replyForm, ReplyFormInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Answer a pending form (agent question). */
export const replyFormAction = async (input: ReplyFormInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(ReplyFormInput)(input)

      yield* replyForm(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.reply-form'))
  )
}
