'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { sendPrompt, SendPromptInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Send a prompt to a session. */
export const sendPromptAction = async (input: SendPromptInput): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(SendPromptInput)(input)

      yield* sendPrompt(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.send-prompt'))
  )
}
