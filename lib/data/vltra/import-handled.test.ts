import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { importHandled, planImportHandled } from '@/lib/data/vltra/import-handled'
import { baseTime, sessionRecord } from '@/lib/data/vltra/testing/fixtures'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const idle = baseTime + 10

const sessions = [
  sessionRecord('ses_viewed', { idle, viewed: idle, title: 'Viewed' }),
  sessionRecord('ses_viewed_later', { idle, viewed: idle + 5 }),
  sessionRecord('ses_unread', { idle, viewed: idle - 1 }),
  sessionRecord('ses_never_viewed', { idle }),
  sessionRecord('ses_never_ran'),
  sessionRecord('ses_marked', { idle, viewed: idle, handled: idle - 3 }),
  sessionRecord('ses_child', { parentID: 'ses_viewed', idle, viewed: idle }),
  sessionRecord('ses_orphan', { parentID: 'ses_gone', idle, viewed: idle })
]

describe('import handled: plan', () => {
  it('marks viewed root runs without a marker; leaves everything else alone', () => {
    const plan = planImportHandled(sessions)

    expect(plan.targets.map(target => target.sessionID)).toEqual([
      'ses_viewed',
      'ses_viewed_later',
      'ses_orphan'
    ])
    expect(plan.targets[0]).toEqual({ sessionID: 'ses_viewed', idle, title: 'Viewed' })
    expect(plan).toMatchObject({ sessions: 8, roots: 7, marked: 1, neverRan: 1, unread: 2 })
  })
})

describe('import handled: run', () => {
  it.effect('a dry run writes nothing', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({ ...emptySnapshot, sessions })

      const result = yield* importHandled({ dryRun: true }).pipe(Effect.provide(fake.layer))

      expect(result.plan.targets).toHaveLength(3)
      expect(result.written).toBe(0)
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect("writes handled = idle, keeps other writers' metadata, and is idempotent", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({ ...emptySnapshot, sessions })

      yield* fake.setMetadata('ses_viewed', { plugin: { pinned: true } })

      const first = yield* importHandled({ dryRun: false }).pipe(Effect.provide(fake.layer))

      expect(first.written).toBe(3)
      expect((yield* fake.calls).map(call => call.op === 'setHandled' && call.sessionID)).toEqual([
        'ses_viewed',
        'ses_viewed_later',
        'ses_orphan'
      ])
      expect(yield* fake.metadata('ses_viewed')).toEqual({
        plugin: { pinned: true },
        vltra: { handled: idle }
      })

      const second = yield* importHandled({ dryRun: false }).pipe(Effect.provide(fake.layer))

      expect(second.plan.targets).toEqual([])
      expect(second.written).toBe(0)
      expect((yield* fake.calls).length).toBe(3)
    })
  )
})
