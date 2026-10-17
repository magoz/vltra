'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { retireWorktree, RetireWorktreeInput } from '@/lib/data/vltra/launcher'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * Retire a dotfiles-owned worktree whose sessions are idle (OpenCode `worktree.remove`, never
 * forced). Refusals, Vltra's and OpenCode's, come back as the error message.
 */
export const retireWorktreeAction = async (
  input: RetireWorktreeInput
): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(RetireWorktreeInput)(input)

      yield* retireWorktree(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.retire-worktree'))
  )
}
