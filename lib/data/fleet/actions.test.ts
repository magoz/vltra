import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  interruptSession,
  markSeen,
  replyForm,
  replyPermission,
  sendPrompt
} from '@/lib/data/fleet/actions'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const snapshot = {
  ...emptySnapshot,
  sessions: [
    sessionRecord('ses_unseen', { idle: baseTime + 10, viewed: baseTime, outcome: 'succeeded' }),
    sessionRecord('ses_seen', { idle: baseTime + 10, viewed: baseTime + 10 }),
    sessionRecord('ses_never')
  ]
}

describe('mark seen', () => {
  it.effect("posts the session's current idle watermark to OpenCode", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const outcome = yield* markSeen({ sessionID: 'ses_unseen' }).pipe(Effect.provide(fake.layer))

      expect(outcome).toBe('marked')
      expect(yield* fake.calls).toEqual([
        { op: 'view', sessionID: 'ses_unseen', idle: baseTime + 10 }
      ])
    })
  )

  it.effect('does nothing for seen or never-finished sessions', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const outcomes = yield* Effect.forEach(['ses_seen', 'ses_never'], sessionID =>
        markSeen({ sessionID }).pipe(Effect.provide(fake.layer))
      )

      expect(outcomes).toEqual(['already-seen', 'already-seen'])
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('fails with SessionNotFoundError for unknown sessions', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const result = yield* markSeen({ sessionID: 'ses_missing' }).pipe(
        Effect.provide(fake.layer),
        Effect.flip
      )

      expect(result._tag).toBe('SessionNotFoundError')
    })
  )

  it.effect('fails with OpenCodeUnavailableError when OpenCode is down', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* fake.failConnects(1)

      const result = yield* markSeen({ sessionID: 'ses_unseen' }).pipe(
        Effect.provide(fake.layer),
        Effect.flip
      )

      expect(result._tag).toBe('OpenCodeUnavailableError')
    })
  )
})

describe('proxied actions', () => {
  it.effect('reply, answer, prompt and interrupt reach OpenCode unchanged', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* Effect.all([
        replyPermission({ sessionID: 'ses_unseen', requestID: 'per_1', decision: 'once' }),
        replyForm({ sessionID: 'ses_unseen', formID: 'frm_1', answer: { a: 'yes' } }),
        sendPrompt({ sessionID: 'ses_unseen', text: 'continue' }),
        interruptSession({ sessionID: 'ses_unseen' })
      ]).pipe(Effect.provide(fake.layer))

      expect(yield* fake.calls).toEqual([
        { op: 'replyPermission', sessionID: 'ses_unseen', requestID: 'per_1' },
        { op: 'replyForm', sessionID: 'ses_unseen', formID: 'frm_1' },
        { op: 'prompt', sessionID: 'ses_unseen', text: 'continue' },
        { op: 'interrupt', sessionID: 'ses_unseen' }
      ])
    })
  )
})
