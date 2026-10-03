'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { retireWorktree, RetireWorktreeInput } from '@/lib/data/fleet/launcher'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Retire a dotfiles-owned worktree whose sessions are idle (OpenCode `worktree.remove`, never
 * forced). Refusals, Fleet's and OpenCode's, come back as the error message.
 */
export const retireWorktreeAction = async (
  input: RetireWorktreeInput
): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(RetireWorktreeInput)(input)

      yield* retireWorktree(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.retire-worktree'))
  )
}
