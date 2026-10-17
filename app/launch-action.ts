'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionValue, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { LaunchInput } from '@/lib/data/vltra/launcher'
import { Launches } from '@/lib/data/vltra/launches'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * Start a new worktree + session for a task (DESIGN.md "Launcher and worktrees"). Returns at once
 * with the launch's id; the worktree is provisioned in the background and the launch's progress
 * reaches the browser through the event stream.
 */
export const launchAction = async (
  input: LaunchInput
): Promise<VltraActionValue<{ readonly launchID: string }>> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(LaunchInput)(input)
      const launch = yield* Effect.flatMap(Launches, launches => launches.start(decoded))

      return VltraActionValue.Success({ launchID: launch.id })
    }).pipe(toActionResult('action.vltra.launch'))
  )
}
