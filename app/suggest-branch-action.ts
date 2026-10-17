'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionValue, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { suggestBranch, SuggestBranchInput } from '@/lib/data/vltra/launcher'
import type { BranchSuggestion } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * A branch name for a task: the model's (validated), else the fallback slug. The same as
 * `POST /api/vltra/launcher/branch`, for the browser.
 */
export const suggestBranchAction = async (
  input: SuggestBranchInput
): Promise<VltraActionValue<BranchSuggestion>> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(SuggestBranchInput)(input)

      return VltraActionValue.Success(yield* suggestBranch(decoded))
    }).pipe(toActionResult('action.vltra.suggest-branch'))
  )
}
