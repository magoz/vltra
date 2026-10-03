import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { FleetActionResult, toActionResult } from '@/app/fleet-action-result'
import type { FleetActionError } from '@/app/fleet-action-result'
import { SessionFolderGoneError } from '@/lib/data/fleet/errors'
import { OpenCodeRequestError } from '@/lib/services/opencode/errors'

const resultOf = (error: FleetActionError) =>
  Effect.fail(error).pipe(Effect.as(FleetActionResult.Success()), toActionResult('action.test'))

describe('toActionResult', () => {
  it.effect("says the session's folder no longer exists", () =>
    Effect.gen(function* () {
      expect(
        yield* resultOf(new SessionFolderGoneError({ sessionID: 'ses_1', directory: '/tmp/x' }))
      ).toEqual(FleetActionResult.Error({ message: "The session's folder no longer exists" }))
    })
  )

  it.effect('names the OpenCode write that failed; other requests stay generic', () =>
    Effect.gen(function* () {
      const failed = (operation: string) =>
        resultOf(new OpenCodeRequestError({ operation, message: 'HTTP 500' }))

      expect(yield* failed('session.update')).toEqual(
        FleetActionResult.Error({ message: 'OpenCode could not save the handled marker' })
      )
      expect(yield* failed('session.get')).toEqual(
        FleetActionResult.Error({ message: 'OpenCode request failed' })
      )
    })
  )
})
