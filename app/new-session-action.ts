'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionValue, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { newSession, NewSessionInput } from '@/lib/data/vltra/launcher'
import type { NewSession } from '@/lib/data/vltra/launcher'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** The launcher's Enter: a new empty session in a repository or worktree. */
export const newSessionAction = async (
  input: NewSessionInput
): Promise<VltraActionValue<NewSession>> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(NewSessionInput)(input)

      return VltraActionValue.Success(yield* newSession(decoded))
    }).pipe(toActionResult('action.vltra.new-session'))
  )
}
