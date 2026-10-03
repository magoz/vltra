'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionValue, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { openCheckout, OpenCheckoutInput } from '@/lib/data/fleet/launcher'
import type { OpenedCheckout } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Open a repository or worktree from the launcher (`openRepo`): its latest root session, or a new
 * empty session there.
 */
export const openCheckoutAction = async (
  input: OpenCheckoutInput
): Promise<FleetActionValue<OpenedCheckout>> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(OpenCheckoutInput)(input)

      return FleetActionValue.Success(yield* openCheckout(decoded))
    }).pipe(toActionResult('action.fleet.open-checkout'))
  )
}
