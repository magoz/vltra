'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionValue, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { newSession, NewSessionInput } from '@/lib/data/fleet/launcher'
import type { NewSession } from '@/lib/data/fleet/launcher'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** The launcher's Enter: a new empty session in a repository or worktree. */
export const newSessionAction = async (
  input: NewSessionInput
): Promise<FleetActionValue<NewSession>> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(NewSessionInput)(input)

      return FleetActionValue.Success(yield* newSession(decoded))
    }).pipe(toActionResult('action.fleet.new-session'))
  )
}
