import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  interruptSession,
  markHandled,
  markViewed,
  reopen,
  replyForm,
  replyPermission,
  sendPrompt
} from '@/lib/data/fleet/actions'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import { FleetStore, makeFleetStore } from '@/lib/data/fleet/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import { snapshotRows } from '@/lib/data/fleet/snapshot'
import {
  makeFakeDirectories,
  presentDirectories
} from '@/lib/services/directories/testing/fake-directories'
import type { Directories } from '@/lib/services/directories/service'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const idle = baseTime + 10

const gone = '/tmp/tmp.gone'

const snapshot: OpenCodeSnapshot = {
  ...emptySnapshot,
  sessions: [
    sessionRecord('ses_finished', { idle, outcome: 'succeeded' }),
    sessionRecord('ses_handled', { idle, handled: idle, outcome: 'failed' }),
    sessionRecord('ses_older', { idle, handled: idle - 5, outcome: 'succeeded' }),
    sessionRecord('ses_never'),
    sessionRecord('ses_blocked', { idle, outcome: 'succeeded' }),
    sessionRecord('ses_working', { idle, outcome: 'succeeded' }),
    sessionRecord('ses_child', { parentID: 'ses_finished', idle, outcome: 'succeeded' }),
    sessionRecord('ses_unread', { idle, viewed: baseTime, outcome: 'succeeded' }),
    sessionRecord('ses_read', { idle, viewed: idle }),
    sessionRecord('ses_gone', { directory: gone, idle, outcome: 'succeeded' }),
    sessionRecord('ses_gone_handled', { directory: gone, idle, handled: idle, outcome: 'failed' }),
    sessionRecord('ses_gone_blocked', { directory: gone, idle, outcome: 'succeeded' })
  ],
  running: ['ses_working'],
  permissions: [
    { id: 'per_1', sessionID: 'ses_blocked', action: 'bash', resources: [] },
    { id: 'per_2', sessionID: 'ses_gone_blocked', action: 'bash', resources: [] }
  ]
}

/** The fake OpenCode plus a store holding the watcher's view of `snapshot`. */
const services = (fake: FakeOpenCode, directories: Layer.Layer<Directories> = presentDirectories) =>
  Layer.mergeAll(
    fake.layer,
    directories,
    Layer.effect(
      FleetStore,
      Effect.gen(function* () {
        const store = yield* makeFleetStore(webUrl)

        yield* store.commit(view => ({ ...view, model: fromSnapshot(snapshot, baseTime) }))

        return store
      })
    )
  )

/** Another writer's keys (a plugin) next to Fleet's own. */
const foreign = { plugin: { pinned: true }, tags: ['a', 'b'] }

describe('mark handled', () => {
  it.effect("writes the stored idle as the handled marker, keeping other writers' keys", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* fake.setMetadata('ses_finished', { ...foreign, fleet: { note: 'kept' } })

      const outcome = yield* markHandled({ sessionID: 'ses_finished' }).pipe(
        Effect.provide(services(fake))
      )

      expect(outcome).toBe('handled')
      expect(yield* fake.calls).toEqual([
        { op: 'setHandled', sessionID: 'ses_finished', handled: idle }
      ])
      expect(yield* fake.metadata('ses_finished')).toEqual({
        ...foreign,
        fleet: { note: 'kept', handled: idle }
      })
    })
  )

  it.effect('handles the latest run when the marker is for an older one', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      expect(
        yield* markHandled({ sessionID: 'ses_older' }).pipe(Effect.provide(services(fake)))
      ).toBe('handled')
      expect(yield* fake.metadata('ses_older')).toEqual({ fleet: { handled: idle } })
    })
  )

  it.effect('reads idle fresh from OpenCode, not from the watcher model', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* fake.setSnapshot({
        ...snapshot,
        sessions: snapshot.sessions.map(session =>
          session.id === 'ses_finished' ? { ...session, idle: idle + 1 } : session
        )
      })

      yield* markHandled({ sessionID: 'ses_finished' }).pipe(Effect.provide(services(fake)))

      expect(yield* fake.calls).toEqual([
        { op: 'setHandled', sessionID: 'ses_finished', handled: idle + 1 }
      ])
    })
  )

  it.effect('leaves handled and never-ran sessions alone', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const outcomes = yield* Effect.forEach(['ses_handled', 'ses_never'], sessionID =>
        markHandled({ sessionID }).pipe(Effect.provide(services(fake)))
      )

      expect(outcomes).toEqual(['already-handled', 'already-handled'])
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('rejects blocked and working sessions, and subagents', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const errors = yield* Effect.forEach(['ses_blocked', 'ses_working', 'ses_child'], sessionID =>
        markHandled({ sessionID }).pipe(Effect.provide(services(fake)), Effect.flip)
      )

      expect(errors.map(error => [error._tag, 'state' in error ? error.state : undefined])).toEqual(
        [
          ['SessionNotFinishedError', 'blocked'],
          ['SessionNotFinishedError', 'working'],
          ['SessionNotFinishedError', undefined]
        ]
      )
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('a session whose folder is gone is already handled, without any OpenCode call', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)
      const directories = yield* makeFakeDirectories([gone])

      yield* Effect.gen(function* () {
        // The watcher has not noticed yet (finished in its model): the fresh check catches it.
        const outcomes = yield* Effect.forEach(['ses_gone', 'ses_gone_handled'], sessionID =>
          markHandled({ sessionID })
        )

        expect(outcomes).toEqual(['already-handled', 'already-handled'])

        // ...and flips the row at once.
        const rows = snapshotRows(yield* Effect.flatMap(FleetStore, store => store.snapshot))

        expect(rows.find(row => row.id === 'ses_gone')).toMatchObject({
          state: 'handled',
          gone: true
        })

        // A pending request still wins: that is what OpenCode reports.
        const error = yield* markHandled({ sessionID: 'ses_gone_blocked' }).pipe(Effect.flip)

        expect(error._tag).toBe('SessionNotFinishedError')
        expect(error).toMatchObject({ state: 'blocked' })
      }).pipe(Effect.provide(services(fake, directories.layer)))

      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('fails with SessionNotFoundError for unknown sessions', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const error = yield* markHandled({ sessionID: 'ses_missing' }).pipe(
        Effect.provide(services(fake)),
        Effect.flip
      )

      expect(error._tag).toBe('SessionNotFoundError')
    })
  )
})

describe('reopen', () => {
  it.effect("removes only the handled marker, keeping other writers' keys", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* fake.setMetadata('ses_handled', { ...foreign, fleet: { handled: idle, note: 'kept' } })

      const outcome = yield* reopen({ sessionID: 'ses_handled' }).pipe(
        Effect.provide(services(fake))
      )

      expect(outcome).toBe('reopened')
      expect(yield* fake.calls).toEqual([
        { op: 'setHandled', sessionID: 'ses_handled', handled: undefined }
      ])
      expect(yield* fake.metadata('ses_handled')).toEqual({ ...foreign, fleet: { note: 'kept' } })
    })
  )

  it.effect('drops the fleet key once nothing else is in it', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* fake.setMetadata('ses_handled', { ...foreign, fleet: { handled: idle } })
      yield* reopen({ sessionID: 'ses_handled' }).pipe(Effect.provide(services(fake)))

      expect(yield* fake.metadata('ses_handled')).toEqual(foreign)
    })
  )

  it.effect('does nothing without a marker; unknown sessions fail', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      expect(
        yield* reopen({ sessionID: 'ses_finished' }).pipe(Effect.provide(services(fake)))
      ).toBe('not-handled')
      expect(yield* fake.calls).toEqual([])

      const error = yield* reopen({ sessionID: 'ses_missing' }).pipe(
        Effect.provide(services(fake)),
        Effect.flip
      )

      expect(error._tag).toBe('SessionNotFoundError')
    })
  )
})

describe('reopen a session whose folder is gone', () => {
  it.effect('fails with SessionFolderGoneError and writes nothing', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)
      const directories = yield* makeFakeDirectories([gone])

      const error = yield* reopen({ sessionID: 'ses_gone_handled' }).pipe(
        Effect.provide(services(fake, directories.layer)),
        Effect.flip
      )

      expect(error._tag).toBe('SessionFolderGoneError')
      expect(error).toMatchObject({ sessionID: 'ses_gone_handled', directory: gone })
      expect(yield* fake.calls).toEqual([])
    })
  )
})

describe('mark viewed (OpenCode unread dots only)', () => {
  it.effect("posts the session's current idle watermark to OpenCode", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const outcome = yield* markViewed({ sessionID: 'ses_unread' }).pipe(
        Effect.provide(services(fake))
      )

      expect(outcome).toBe('marked')
      expect(yield* fake.calls).toEqual([{ op: 'view', sessionID: 'ses_unread', idle }])
    })
  )

  it.effect('does nothing for read or never-finished sessions', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      const outcomes = yield* Effect.forEach(['ses_read', 'ses_never'], sessionID =>
        markViewed({ sessionID }).pipe(Effect.provide(services(fake)))
      )

      expect(outcomes).toEqual(['already-viewed', 'already-viewed'])
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('fails with OpenCodeUnavailableError when OpenCode is down', () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeOpenCode(snapshot)

      yield* fake.failConnects(1)

      const result = yield* markViewed({ sessionID: 'ses_unread' }).pipe(
        Effect.provide(services(fake)),
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
        replyPermission({ sessionID: 'ses_blocked', requestID: 'per_1', decision: 'once' }),
        replyForm({ sessionID: 'ses_blocked', formID: 'frm_1', answer: { a: 'yes' } }),
        sendPrompt({ sessionID: 'ses_blocked', text: 'continue' }),
        interruptSession({ sessionID: 'ses_working' })
      ]).pipe(Effect.provide(services(fake)))

      expect(yield* fake.calls).toEqual([
        { op: 'replyPermission', sessionID: 'ses_blocked', requestID: 'per_1' },
        { op: 'replyForm', sessionID: 'ses_blocked', formID: 'frm_1' },
        { op: 'prompt', sessionID: 'ses_blocked', text: 'continue' },
        { op: 'interrupt', sessionID: 'ses_working' }
      ])
    })
  )
})
