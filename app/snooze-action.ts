'use server'

import { Effect, Schema } from 'effect'
import { headers } from 'next/headers'
import { VltraActionResult, toActionResult } from '@/app/vltra-action-result'
import { requireSameOrigin } from '@/app/same-origin'
import { snooze, SnoozeInput, unsnooze, UnsnoozeInput } from '@/lib/data/vltra/actions'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/** Snooze a finished root session's latest run until a time (`metadata.vltra.snoozed`). */
export const snoozeAction = async (input: SnoozeInput): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(SnoozeInput)(input)

      yield* snooze(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.snooze'))
  )
}

/** Bring a snoozed session back now: remove its snooze marker. */
export const unsnoozeAction = async (input: UnsnoozeInput): Promise<VltraActionResult> => {
  const requestHeaders = await headers()

  return await runVltra(
    Effect.gen(function* () {
      yield* requireSameOrigin(requestHeaders)

      const decoded = yield* Schema.decodeUnknownEffect(UnsnoozeInput)(input)

      yield* unsnooze(decoded)

      return VltraActionResult.Success()
    }).pipe(toActionResult('action.vltra.unsnooze'))
  )
}
