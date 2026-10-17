import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SessionSummaries, SessionSummariesLive, totals } from '@/lib/data/vltra/session-detail'
import { fromSnapshot } from '@/lib/data/vltra/model'
import { VltraStore, makeVltraStore } from '@/lib/data/vltra/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { FileChange, Transcript } from '@/lib/data/vltra/types'
import {
  makeFakeDirectories,
  presentDirectories
} from '@/lib/services/directories/testing/fake-directories'
import type { Directories } from '@/lib/services/directories/service'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

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

const gone = '/tmp/tmp.gone'

const sessions = {
  ...emptySnapshot,
  sessions: [
    sessionRecord('ses_1', { idle: baseTime, outcome: 'succeeded' }),
    sessionRecord('ses_gone', { directory: gone, idle: baseTime, outcome: 'succeeded' })
  ]
}

/** OpenCode, the session folders, and a store holding the watcher's view of `sessions`. */
const services = (fake: FakeOpenCode, directories: Layer.Layer<Directories> = presentDirectories) =>
  Layer.mergeAll(
    fake.layer,
    directories,
    Layer.effect(
      VltraStore,
      Effect.gen(function* () {
        const store = yield* makeVltraStore(webUrl)

        yield* store.commit(view => ({ ...view, model: fromSnapshot(sessions, baseTime) }))

        return store
      })
    )
  )

describe('finished-run summaries', () => {
  const withSummaries = <A, E>(
    fake: FakeOpenCode,
    effect: Effect.Effect<A, E, SessionSummaries>,
    directories: Layer.Layer<Directories> = presentDirectories
  ) =>
    effect.pipe(
      Effect.provide(SessionSummariesLive.pipe(Layer.provide(services(fake, directories))))
    )

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

  it.effect('a failed diff only drops the change totals', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode()

      yield* fake.setTranscript('ses_1', transcript)
      yield* fake.setDiff('ses_1', 'fail')

      const summary = yield* withSummaries(
        fake,
        Effect.flatMap(SessionSummaries, summaries =>
          summaries.get({ sessionID: 'ses_1', idle: baseTime })
        )
      )

      expect(summary.answer).toBe('Updated README and 3 guides.')
      expect(summary.changes).toBeUndefined()
    })
  )

  it.effect('a session whose folder is gone gets its answer without a diff', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode()
      const directories = yield* makeFakeDirectories([gone])

      yield* fake.setTranscript('ses_gone', transcript)

      const summary = yield* withSummaries(
        fake,
        Effect.flatMap(SessionSummaries, summaries =>
          summaries.get({ sessionID: 'ses_gone', idle: baseTime })
        ),
        directories.layer
      )

      expect(summary).toEqual({
        sessionID: 'ses_gone',
        idle: baseTime,
        answer: 'Updated README and 3 guides.',
        changes: undefined
      })
      expect((yield* fake.calls).map(call => call.op)).toEqual(['transcript'])
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

  it('totals changed files', () => {
    expect(totals(files)).toEqual({ files: 2, additions: 72, deletions: 31 })
  })
})
