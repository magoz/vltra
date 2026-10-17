'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { deleteProject, DeleteProjectInput } from '@/lib/data/vltra/actions'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Delete a Projects card's sessions in OpenCode, for good; refused while any is busy. */
export const deleteProjectAction = async (
  input: DeleteProjectInput
): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(DeleteProjectInput)(input)

      yield* deleteProject(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.delete-project'))
  )
}
