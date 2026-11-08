import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import type { VltraActionError } from '@/app/vltra-action-result'
import { OpenCodeRequestError } from '@/lib/services/opencode/errors'

const resultOf = (error: VltraActionError) =>
  Effect.fail(error).pipe(Effect.as(VltraActionResult.Success()), toActionResult('action.test'))

describe('toActionResult', () => {
  it.effect('names the OpenCode write that failed; other requests stay generic', () =>
    Effect.gen(function* () {
      const failed = (operation: string) =>
        resultOf(new OpenCodeRequestError({ operation, message: 'HTTP 500' }))

      expect(yield* failed('session.update')).toEqual(
        VltraActionResult.Error({ message: 'OpenCode could not mark it done' })
      )
      expect(yield* failed('session.get')).toEqual(
        VltraActionResult.Error({ message: 'OpenCode request failed' })
      )
    })
  )
})
