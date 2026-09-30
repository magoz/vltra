'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { replyPermission, ReplyPermissionInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Approve (`once`/`always`) or deny (`reject`) a pending permission. */
export const replyPermissionAction = async (
  input: ReplyPermissionInput
): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(ReplyPermissionInput)(input)

      yield* replyPermission(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.reply-permission'))
  )
}
