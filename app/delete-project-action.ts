'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { deleteProject, DeleteProjectInput } from '@/lib/data/fleet/actions'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/** Delete a Projects card's sessions in OpenCode, for good; refused while any is busy. */
export const deleteProjectAction = async (
  input: DeleteProjectInput
): Promise<FleetActionResult> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(DeleteProjectInput)(input)

      yield* deleteProject(decoded)

      return FleetActionResult.Success()
    }).pipe(toActionResult('action.fleet.delete-project'))
  )
}
