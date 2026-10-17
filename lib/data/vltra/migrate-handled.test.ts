import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { migrateHandled } from '@/lib/data/vltra/migrate-handled'
import { baseTime, sessionRecord } from '@/lib/data/vltra/testing/fixtures'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const idle = baseTime + 10

const sessions = [
  sessionRecord('ses_legacy', { idle }),
  sessionRecord('ses_current', { idle, handled: idle }),
  sessionRecord('ses_open', { idle })
]

describe('migrate handled', () => {
  it.effect('a dry run writes nothing', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({ ...emptySnapshot, sessions })

      yield* fake.setMetadata('ses_legacy', { fleet: { handled: idle } })

      const result = yield* migrateHandled({ dryRun: true }).pipe(Effect.provide(fake.layer))

      expect(result).toEqual({ sessions: 3, marked: 2, written: 0 })
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect("moves fleet.handled to vltra.handled, keeping other writers' metadata", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({ ...emptySnapshot, sessions })

      yield* fake.setMetadata('ses_legacy', { plugin: { pinned: true }, fleet: { handled: idle } })

      const result = yield* migrateHandled({ dryRun: false }).pipe(Effect.provide(fake.layer))

      expect(result).toEqual({ sessions: 3, marked: 2, written: 2 })

      expect(yield* fake.metadata('ses_legacy')).toEqual({
        plugin: { pinned: true },
        vltra: { handled: idle }
      })

      expect(yield* fake.metadata('ses_current')).toEqual({ vltra: { handled: idle } })
      expect(yield* fake.metadata('ses_open')).toEqual({})
    })
  )
})
