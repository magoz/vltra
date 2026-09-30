import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import { snapshotRows } from '@/lib/data/fleet/snapshot'
import { FleetStore, makeFleetStore } from '@/lib/data/fleet/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import { defaultWatcherOptions, FleetWatcherLive } from '@/lib/data/fleet/watcher'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const withWatcher = (fake: FakeOpenCode) =>
  FleetWatcherLive(defaultWatcherOptions).pipe(
    Layer.provideMerge(Layer.effect(FleetStore, makeFleetStore(webUrl))),
    Layer.provide(fake.layer)
  )

/** Lets forked fibers (watcher, stream) run without advancing the test clock. */
const settle = Effect.repeat(Effect.yieldNow, { times: 200 })

const snapshot = Effect.flatMap(FleetStore, store => store.snapshot)

const rowStates = Effect.map(snapshot, value =>
  Object.fromEntries(snapshotRows(value).map(row => [row.id, row.state]))
)

const connection = Effect.map(snapshot, value => value.connection)

const initial = {
  ...emptySnapshot,
  sessions: [
    sessionRecord('ses_a'),
    sessionRecord('ses_b', { idle: baseTime + 1, outcome: 'failed' })
  ]
}

describe('watcher', () => {
  it.effect('subscribes, loads the snapshot, then applies live events', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)

      yield* Effect.gen(function* () {
        yield* settle

        expect((yield* connection).status).toBe('connected')
        expect(yield* rowStates).toEqual({ ses_a: 'idle', ses_b: 'failed' })

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: FleetEvent.ExecutionStarted({ sessionID: 'ses_a', at: baseTime + 5 })
          })
        )

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: FleetEvent.PermissionAsked({
              permission: { id: 'per_1', sessionID: 'ses_b', action: 'bash', resources: [] }
            })
          })
        )

        yield* settle

        expect(yield* rowStates).toEqual({ ses_a: 'working', ses_b: 'needs-you' })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('applies events buffered while the snapshot loads', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)
      const hold = yield* fake.holdSnapshot

      yield* Effect.gen(function* () {
        yield* settle

        expect((yield* connection).status).toBe('connecting')

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: FleetEvent.ExecutionStarted({ sessionID: 'ses_a', at: baseTime + 5 })
          })
        )

        yield* settle
        yield* hold.release
        yield* settle

        expect((yield* connection).status).toBe('connected')
        expect(yield* rowStates).toEqual({ ses_a: 'working', ses_b: 'failed' })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('reads sessions it has not seen before applying their events', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)

      yield* Effect.gen(function* () {
        yield* settle

        // Created after the snapshot: OpenCode has it, the model does not yet.
        yield* fake.setSnapshot({
          ...initial,
          sessions: [...initial.sessions, sessionRecord('ses_c')]
        })

        yield* fake.emit(OpenCodeSignal.RefreshSession({ sessionID: 'ses_c' }))

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: FleetEvent.ExecutionStarted({ sessionID: 'ses_c', at: baseTime + 5 })
          })
        )

        yield* settle

        expect((yield* rowStates).ses_c).toBe('working')
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('retries failed connections with exponential backoff', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)

      yield* fake.failConnects(4)

      yield* Effect.gen(function* () {
        yield* settle

        expect(yield* fake.connectAttempts).toBe(1)
        expect(yield* connection).toMatchObject({ status: 'disconnected', failures: 1 })

        // 0.5s, 1s, 2s, 4s between attempts.
        for (const [delay, attempts] of [
          [500, 2],
          [1000, 3],
          [2000, 4]
        ] as const) {
          yield* TestClock.adjust(Duration.millis(delay - 1))
          yield* settle

          expect(yield* fake.connectAttempts).toBe(attempts - 1)

          yield* TestClock.adjust(Duration.millis(1))
          yield* settle

          expect(yield* fake.connectAttempts).toBe(attempts)
        }

        expect((yield* connection).failures).toBe(4)

        yield* TestClock.adjust(Duration.seconds(4))
        yield* settle

        expect(yield* fake.connectAttempts).toBe(5)
        expect(yield* connection).toMatchObject({ status: 'connected', failures: 0 })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('caps the backoff at 30 seconds', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)

      yield* fake.failConnects(100)

      yield* Effect.gen(function* () {
        yield* settle

        // 0.5 + 1 + 2 + 4 + 8 + 16 = 31.5s for the first 7 attempts; then every 30s.
        yield* TestClock.adjust(Duration.millis(31_500))
        yield* settle

        expect(yield* fake.connectAttempts).toBe(7)

        yield* TestClock.adjust(Duration.millis(29_999))
        yield* settle

        expect(yield* fake.connectAttempts).toBe(7)

        yield* TestClock.adjust(Duration.millis(1))
        yield* settle

        expect(yield* fake.connectAttempts).toBe(8)
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('resyncs from a fresh snapshot after a disconnect', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)

      yield* Effect.gen(function* () {
        yield* settle

        expect(yield* fake.snapshotLoads).toBe(1)

        // While the stream is down, OpenCode moves on: a new session and ses_b gets seen.
        yield* fake.disconnect

        yield* fake.setSnapshot({
          ...initial,
          sessions: [
            sessionRecord('ses_a'),
            sessionRecord('ses_b', { idle: baseTime + 1, viewed: baseTime + 1, outcome: 'failed' }),
            sessionRecord('ses_new', { idle: baseTime + 2, outcome: 'succeeded' })
          ]
        })

        yield* settle

        expect((yield* connection).status).toBe('disconnected')
        // Stale rows stay visible while disconnected.
        expect((yield* rowStates).ses_b).toBe('failed')

        yield* TestClock.adjust(defaultWatcherOptions.dropDelay)
        yield* settle

        expect(yield* fake.connectAttempts).toBe(2)
        expect(yield* fake.snapshotLoads).toBe(2)
        expect((yield* connection).status).toBe('connected')
        expect(yield* rowStates).toEqual({ ses_a: 'idle', ses_b: 'idle', ses_new: 'done' })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )
})
