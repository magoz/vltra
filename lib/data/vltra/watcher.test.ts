import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { VltraEvent, OpenCodeSignal } from '@/lib/data/vltra/events'
import { snapshotRows } from '@/lib/data/vltra/snapshot'
import { quietAfter } from '@/lib/data/vltra/state'
import { VltraStore, makeVltraStore } from '@/lib/data/vltra/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { InterruptReason } from '@/lib/data/vltra/types'
import { defaultWatcherOptions, VltraWatcherLive } from '@/lib/data/vltra/watcher'
import {
  makeFakeDirectories,
  presentDirectories
} from '@/lib/services/directories/testing/fake-directories'
import type { Directories } from '@/lib/services/directories/service'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const withWatcher = (
  fake: FakeOpenCode,
  directories: Layer.Layer<Directories> = presentDirectories
) =>
  VltraWatcherLive(defaultWatcherOptions).pipe(
    Layer.provideMerge(Layer.effect(VltraStore, makeVltraStore(webUrl))),
    Layer.provide(fake.layer),
    Layer.provide(directories)
  )

/** Lets forked fibers (watcher, stream) run without advancing the test clock. */
const settle = Effect.repeat(Effect.yieldNow, { times: 200 })

const snapshot = Effect.flatMap(VltraStore, store => store.snapshot)

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
        expect(yield* rowStates).toEqual({ ses_a: 'handled', ses_b: 'finished' })

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: VltraEvent.ExecutionStarted({ sessionID: 'ses_a', at: baseTime + 5 })
          })
        )

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: VltraEvent.PermissionAsked({
              permission: { id: 'per_1', sessionID: 'ses_b', action: 'bash', resources: [] }
            })
          })
        )

        yield* settle

        expect(yield* rowStates).toEqual({ ses_a: 'working', ses_b: 'blocked' })
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
            event: VltraEvent.ExecutionStarted({ sessionID: 'ses_a', at: baseTime + 5 })
          })
        )

        yield* settle
        yield* hold.release
        yield* settle

        expect((yield* connection).status).toBe('connected')
        expect(yield* rowStates).toEqual({ ses_a: 'working', ses_b: 'finished' })
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
            event: VltraEvent.ExecutionStarted({ sessionID: 'ses_c', at: baseTime + 5 })
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

        // While the stream is down, OpenCode moves on: a new session and ses_b gets handled.
        yield* fake.disconnect

        yield* fake.setSnapshot({
          ...initial,
          sessions: [
            sessionRecord('ses_a'),
            sessionRecord('ses_b', {
              idle: baseTime + 1,
              handled: baseTime + 1,
              outcome: 'failed'
            }),
            sessionRecord('ses_new', { idle: baseTime + 2, outcome: 'succeeded' })
          ]
        })

        yield* settle

        expect((yield* connection).status).toBe('disconnected')
        // Stale rows stay visible while disconnected.
        expect((yield* rowStates).ses_b).toBe('finished')

        yield* TestClock.adjust(defaultWatcherOptions.dropDelay)
        yield* settle

        expect(yield* fake.connectAttempts).toBe(2)
        expect(yield* fake.snapshotLoads).toBe(2)
        expect((yield* connection).status).toBe('connected')
        expect(yield* rowStates).toEqual({
          ses_a: 'handled',
          ses_b: 'handled',
          ses_new: 'finished'
        })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('applies handled markers from session.metadata.updated', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(initial)

      yield* Effect.gen(function* () {
        yield* settle

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: VltraEvent.HandledChanged({ sessionID: 'ses_b', handled: baseTime + 1 })
          })
        )

        yield* settle

        expect((yield* rowStates).ses_b).toBe('handled')

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: VltraEvent.HandledChanged({ sessionID: 'ses_b', handled: undefined })
          })
        )

        yield* settle

        expect((yield* rowStates).ses_b).toBe('finished')
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('keeps stuck counts current without events', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({ ...initial, running: ['ses_a'] })

      yield* Effect.gen(function* () {
        yield* settle

        expect((yield* snapshot).counts).toMatchObject({ working: 1, stuck: 0 })

        yield* TestClock.adjust(Duration.millis(quietAfter))
        yield* settle

        expect((yield* snapshot).counts).toMatchObject({ working: 1, stuck: 1 })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )
})

describe('session folders', () => {
  const gone = '/tmp/tmp.gone'
  const worktree = '/home/me/dev/repos/vltra-merged'

  const rowOf = (id: string) =>
    Effect.map(snapshot, value => snapshotRows(value).find(row => row.id === id))

  const folders = {
    ...emptySnapshot,
    sessions: [
      sessionRecord('ses_here', { idle: baseTime + 1, outcome: 'succeeded' }),
      sessionRecord('ses_gone', { directory: gone, idle: baseTime + 2, outcome: 'failed' }),
      sessionRecord('ses_gone_too', { directory: gone, idle: baseTime + 3, outcome: 'succeeded' }),
      sessionRecord('ses_worktree', {
        directory: worktree,
        idle: baseTime + 4,
        outcome: 'succeeded'
      })
    ]
  }

  it.effect('a snapshot checks each distinct folder once; a gone folder is handled', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(folders)
      const directories = yield* makeFakeDirectories([gone])

      yield* Effect.gen(function* () {
        yield* settle

        expect(yield* rowStates).toEqual({
          ses_here: 'finished',
          ses_gone: 'handled',
          ses_gone_too: 'handled',
          ses_worktree: 'finished'
        })
        expect(yield* rowOf('ses_gone')).toMatchObject({ gone: true, handled: undefined })
        expect((yield* rowOf('ses_here'))?.gone).toBe(false)
        expect((yield* snapshot).counts).toMatchObject({ finished: 2, handled: 2 })

        const snapshotCheck = (yield* directories.checks).find(list => list.length > 0)

        expect(snapshotCheck?.toSorted()).toEqual(
          ['/home/me/dev/repos/vltra', gone, worktree].toSorted()
        )
      }).pipe(Effect.provide(withWatcher(fake, directories.layer)))
    })
  )

  it.effect('a folder deleted later flips its session to handled on the recount tick', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(folders)
      const directories = yield* makeFakeDirectories()

      yield* Effect.gen(function* () {
        yield* settle

        expect((yield* rowStates).ses_worktree).toBe('finished')

        // The worktree is removed after merge; nothing in OpenCode changes.
        yield* directories.remove(worktree)
        yield* TestClock.adjust(
          Duration.millis(Duration.toMillis(defaultWatcherOptions.recount) - 1)
        )
        yield* settle

        expect((yield* rowStates).ses_worktree).toBe('finished')

        yield* TestClock.adjust(Duration.millis(1))
        yield* settle

        expect(yield* rowOf('ses_worktree')).toMatchObject({ state: 'handled', gone: true })
        expect(yield* fake.calls).toEqual([])
      }).pipe(Effect.provide(withWatcher(fake, directories.layer)))
    })
  )

  it.effect('a new session in an unchecked folder is checked when it is read', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(folders)
      const directories = yield* makeFakeDirectories(['/tmp/tmp.new'])

      yield* Effect.gen(function* () {
        yield* settle

        yield* fake.setSnapshot({
          ...folders,
          sessions: [
            ...folders.sessions,
            sessionRecord('ses_new', {
              directory: '/tmp/tmp.new',
              idle: baseTime + 5,
              outcome: 'succeeded'
            })
          ]
        })

        const before = (yield* directories.checks).length

        yield* fake.emit(OpenCodeSignal.RefreshSession({ sessionID: 'ses_new' }))
        yield* settle

        expect(yield* rowOf('ses_new')).toMatchObject({ state: 'handled', gone: true })
        expect((yield* directories.checks).slice(before)).toEqual([['/tmp/tmp.new']])
      }).pipe(Effect.provide(withWatcher(fake, directories.layer)))
    })
  )

  it.effect('a gone session never gets an OpenCode write: no recovery, no auto-handle', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({
        ...emptySnapshot,
        sessions: [
          sessionRecord('ses_missed', {
            directory: gone,
            idle: baseTime + 1,
            outcome: 'interrupted'
          }),
          sessionRecord('ses_live', { directory: gone })
        ],
        running: ['ses_live']
      })

      const directories = yield* makeFakeDirectories([gone])

      yield* fake.setInterruptReason('ses_missed', 'user')

      yield* Effect.gen(function* () {
        yield* settle

        // Running wins over a gone folder: OpenCode says it works.
        expect(yield* rowStates).toEqual({ ses_missed: 'handled', ses_live: 'working' })

        yield* fake.emit(
          OpenCodeSignal.Apply({
            event: VltraEvent.ExecutionEnded({
              sessionID: 'ses_live',
              at: baseTime + 5,
              outcome: 'interrupted',
              reason: 'user'
            })
          })
        )
        yield* settle

        expect(yield* rowStates).toEqual({ ses_missed: 'handled', ses_live: 'handled' })
        expect(yield* fake.calls).toEqual([])
      }).pipe(Effect.provide(withWatcher(fake, directories.layer)))
    })
  )
})

describe('interrupt reasons', () => {
  const ended = (sessionID: string, reason: InterruptReason, at = baseTime + 5) =>
    OpenCodeSignal.Apply({
      event: VltraEvent.ExecutionEnded({ sessionID, at, outcome: 'interrupted', reason })
    })

  const rowOf = (id: string) =>
    Effect.map(snapshot, value => snapshotRows(value).find(row => row.id === id))

  const running = {
    ...emptySnapshot,
    sessions: [sessionRecord('ses_root'), sessionRecord('ses_child', { parentID: 'ses_root' })],
    running: ['ses_root', 'ses_child']
  }

  /** What OpenCode stores once the interruption is projected (idle can be event time + 1). */
  const storedInterrupt = (idle: number) => ({
    ...running,
    sessions: running.sessions.map(session => ({
      ...session,
      idle,
      outcome: 'interrupted' as const
    })),
    running: []
  })

  it.effect('a root session stopped by the user is marked handled at the stored idle', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(running)

      yield* Effect.gen(function* () {
        yield* settle
        yield* fake.setSnapshot(storedInterrupt(baseTime + 6))
        yield* fake.emit(ended('ses_root', 'user'))
        yield* settle

        expect(yield* fake.calls).toEqual([
          { op: 'setHandled', sessionID: 'ses_root', handled: baseTime + 6 }
        ])
        expect(yield* rowOf('ses_root')).toMatchObject({
          state: 'working',
          handled: baseTime + 6,
          interrupt: 'user'
        })

        // The subagent stopped too: its run is not auto-handled (only roots are).
        yield* fake.emit(ended('ses_child', 'user'))
        yield* settle

        expect((yield* fake.calls).length).toBe(1)
        expect((yield* rowOf('ses_root'))?.state).toBe('handled')
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  it.effect('an inactivity stop stays finished, labelled with its reason', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode({ ...running, sessions: [sessionRecord('ses_root')] })

      yield* Effect.gen(function* () {
        yield* settle
        yield* fake.emit(ended('ses_root', 'inactivity'))
        yield* settle

        expect(yield* fake.calls).toEqual([])
        expect(yield* rowOf('ses_root')).toMatchObject({
          state: 'finished',
          outcome: 'interrupted',
          interrupt: 'inactivity'
        })
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )

  const missed = {
    ...emptySnapshot,
    sessions: [
      sessionRecord('ses_user', { idle: baseTime + 1, outcome: 'interrupted' }),
      sessionRecord('ses_evicted', { idle: baseTime + 2, outcome: 'interrupted' }),
      sessionRecord('ses_unknown', { idle: baseTime + 3, outcome: 'interrupted' }),
      sessionRecord('ses_done', {
        idle: baseTime + 4,
        handled: baseTime + 4,
        outcome: 'interrupted'
      }),
      sessionRecord('ses_sub', {
        parentID: 'ses_done',
        idle: baseTime + 5,
        outcome: 'interrupted'
      }),
      sessionRecord('ses_ok', { idle: baseTime + 6, outcome: 'succeeded' })
    ]
  }

  it.effect('recovers missed reasons from the session log once per run, and auto-handles', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(missed)

      yield* fake.setInterruptReason('ses_user', 'user')
      yield* fake.setInterruptReason('ses_evicted', 'inactivity')

      yield* Effect.gen(function* () {
        yield* settle

        // Only finished, unhandled root sessions that ended interrupted are looked up.
        const reads = (yield* fake.calls).filter(call => call.op === 'interruptReason')

        expect(reads.map(call => call.sessionID).toSorted()).toEqual([
          'ses_evicted',
          'ses_unknown',
          'ses_user'
        ])
        expect((yield* fake.calls).filter(call => call.op === 'setHandled')).toEqual([
          { op: 'setHandled', sessionID: 'ses_user', handled: baseTime + 1 }
        ])
        expect(yield* rowOf('ses_user')).toMatchObject({ state: 'handled', interrupt: 'user' })
        expect(yield* rowOf('ses_evicted')).toMatchObject({
          state: 'finished',
          interrupt: 'inactivity'
        })
        expect((yield* rowOf('ses_unknown'))?.interrupt).toBeUndefined()

        // A reconnect reloads the snapshot (reasons are not in it) but reads no log again.
        yield* fake.disconnect
        yield* TestClock.adjust(defaultWatcherOptions.dropDelay)
        yield* settle

        expect(yield* fake.snapshotLoads).toBe(2)
        expect((yield* fake.calls).filter(call => call.op === 'interruptReason')).toHaveLength(3)
        expect((yield* rowOf('ses_evicted'))?.interrupt).toBe('inactivity')
      }).pipe(Effect.provide(withWatcher(fake)))
    })
  )
})
