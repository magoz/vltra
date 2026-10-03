'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionValue, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { LaunchInput } from '@/lib/data/fleet/launcher'
import { Launches } from '@/lib/data/fleet/launches'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Start a new worktree + session for a task (DESIGN.md "Launcher and worktrees"). Returns at once
 * with the launch's id; the worktree is provisioned in the background and the launch's progress
 * reaches the browser through the event stream.
 */
export const launchAction = async (
  input: LaunchInput
): Promise<FleetActionValue<{ readonly launchID: string }>> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(LaunchInput)(input)
      const launch = yield* Effect.flatMap(Launches, launches => launches.start(decoded))

      return FleetActionValue.Success({ launchID: launch.id })
    }).pipe(toActionResult('action.fleet.launch'))
  )
}
