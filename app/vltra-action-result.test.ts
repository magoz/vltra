import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import type { VltraActionError } from '@/app/vltra-action-result'
import { SessionFolderGoneError } from '@/lib/data/vltra/errors'
import { OpenCodeRequestError } from '@/lib/services/opencode/errors'

const resultOf = (error: VltraActionError) =>
  Effect.fail(error).pipe(Effect.as(VltraActionResult.Success()), toActionResult('action.test'))

describe('toActionResult', () => {
  it.effect("says the session's folder no longer exists", () =>
    Effect.gen(function* () {
      expect(
        yield* resultOf(new SessionFolderGoneError({ sessionID: 'ses_1', directory: '/tmp/x' }))
      ).toEqual(VltraActionResult.Error({ message: "The session's folder no longer exists" }))
    })
  )

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
