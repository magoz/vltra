'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { FleetActionValue, toActionResult } from '@/app/fleet-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { suggestBranch, SuggestBranchInput } from '@/lib/data/fleet/launcher'
import type { BranchSuggestion } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * A branch name for a task: the model's (validated), else the fallback slug. The same as
 * `POST /api/fleet/launcher/branch`, for the browser.
 */
export const suggestBranchAction = async (
  input: SuggestBranchInput
): Promise<FleetActionValue<BranchSuggestion>> => {
  const requestHeaders = await headers()

  return await runFleet(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(SuggestBranchInput)(input)

      return FleetActionValue.Success(yield* suggestBranch(decoded))
    }).pipe(toActionResult('action.fleet.suggest-branch'))
  )
}
