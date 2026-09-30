import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  loadSessionDetail,
  SessionSummaries,
  SessionSummariesLive,
  totals
} from '@/lib/data/fleet/session-detail'
import { baseTime } from '@/lib/data/fleet/testing/fixtures'
import type { FileChange, Transcript } from '@/lib/data/fleet/types'
import { makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const transcript: Transcript = {
  entries: [
    { id: 'msg_1', role: 'user', text: 'Rewrite the README', at: baseTime },
    { id: 'msg_2:0', role: 'agent', text: 'Updated README and 3 guides.', at: baseTime + 1 }
  ],
  answer: 'Updated README and 3 guides.'
}

const files: ReadonlyArray<FileChange> = [
  { file: 'README.md', additions: 64, deletions: 31, status: 'modified' },
  { file: 'docs/faq.md', additions: 8, deletions: 0, status: 'added' }
]

describe('session detail', () => {
  it.effect('reads the transcript tail and the latest turn files', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode()

      yield* fake.setTranscript('ses_1', transcript)
      yield* fake.setDiff('ses_1', files)

      const detail = yield* loadSessionDetail({ sessionID: 'ses_1' }).pipe(
        Effect.provide(fake.layer)
      )

      expect(detail).toEqual({ sessionID: 'ses_1', transcript, files })
    })
  )

  it.effect('a failed diff only hides the file list', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode()

      yield* fake.setTranscript('ses_1', transcript)
      yield* fake.setDiff('ses_1', 'fail')

      const detail = yield* loadSessionDetail({ sessionID: 'ses_1' }).pipe(
        Effect.provide(fake.layer)
      )

      expect(detail.transcript).toEqual(transcript)
      expect(detail.files).toBeUndefined()
    })
  )

  it('totals changed files', () => {
    expect(totals(files)).toEqual({ files: 2, additions: 72, deletions: 31 })
  })
})

describe('finished-run summaries', () => {
  const withSummaries = <A, E>(
    fake: Effect.Success<ReturnType<typeof makeFakeOpenCode>>,
    effect: Effect.Effect<A, E, SessionSummaries>
  ) => effect.pipe(Effect.provide(SessionSummariesLive.pipe(Layer.provide(fake.layer))))

  const summaryReads = (fake: Effect.Success<ReturnType<typeof makeFakeOpenCode>>) =>
    Effect.map(fake.calls, calls => calls.filter(call => call.op === 'transcript').length)

  it.effect('reads the answer and change totals once per (session, idle)', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode()

      yield* fake.setTranscript('ses_1', transcript)
      yield* fake.setDiff('ses_1', files)

      const [first, second, next] = yield* withSummaries(
        fake,
        Effect.flatMap(SessionSummaries, summaries =>
          Effect.all([
            summaries.get({ sessionID: 'ses_1', idle: baseTime }),
            summaries.get({ sessionID: 'ses_1', idle: baseTime }),
            summaries.get({ sessionID: 'ses_1', idle: baseTime + 5 })
          ])
        )
      )

      expect(first).toEqual({
        sessionID: 'ses_1',
        idle: baseTime,
        answer: 'Updated README and 3 guides.',
        changes: { files: 2, additions: 72, deletions: 31 }
      })

      expect(second).toEqual(first)
      expect(next?.idle).toBe(baseTime + 5)
      // Two distinct runs, two reads; the repeat was served from the cache.
      expect(yield* summaryReads(fake)).toBe(2)
      expect(yield* fake.calls).toContainEqual({
        op: 'transcript',
        sessionID: 'ses_1',
        assistantOnly: true
      })
    })
  )

  it.effect('does not cache failures', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode()

      yield* fake.failConnects(1)

      const outcomes = yield* withSummaries(
        fake,
        Effect.flatMap(SessionSummaries, summaries =>
          Effect.all([
            Effect.flip(summaries.get({ sessionID: 'ses_1', idle: baseTime })),
            summaries.get({ sessionID: 'ses_1', idle: baseTime })
          ])
        )
      )

      expect(outcomes[0]._tag).toBe('OpenCodeUnavailableError')
      expect(outcomes[1].answer).toBeUndefined()
      expect(yield* fake.connectAttempts).toBe(2)
    })
  )
})
