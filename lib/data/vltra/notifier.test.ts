import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { Duration } from 'effect'
import { TestClock } from 'effect/testing'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, fromSnapshot } from '@/lib/data/vltra/model'
import { notifyAttention } from '@/lib/data/vltra/notifier'
import { VltraStore, makeVltraStore } from '@/lib/data/vltra/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { VltraConnection } from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'
import { makeFakePush } from '@/lib/services/push/testing/fake-push'

const connection: VltraConnection = { status: 'connected', since: baseTime, failures: 0 }

const working = fromSnapshot(
  {
    ...emptySnapshot,
    sessions: [sessionRecord('ses_a'), sessionRecord('ses_b')],
    running: ['ses_a', 'ses_b'],
    projects: [{ id: 'prj_vltra', name: 'vltra', directory: '/home/me/dev/repos/vltra' }]
  },
  baseTime
)

const permission = (sessionID: string) =>
  VltraEvent.PermissionAsked({
    permission: { id: `per_${sessionID}`, sessionID, action: 'bash', resources: [] }
  })

/** A store and a fake push with the notifier running on them, connected to `working`. */
const setup = Effect.gen(function* () {
  const push = yield* makeFakePush([{ id: 'phone', label: 'iPhone · app', createdAt: 0 }])
  const store = yield* makeVltraStore(webUrl)

  yield* notifyAttention.pipe(
    Effect.provideService(VltraStore, store),
    Effect.provide(push.layer),
    Effect.forkChild
  )
  yield* Effect.repeat(Effect.yieldNow, { times: 20 })
  yield* store.commit(() => ({ connection, model: working }))

  const apply = (event: VltraEvent) =>
    store.commit(view => ({ ...view, model: applyEvent(view.model, event) }))

  return { push, apply }
})

const settle = Effect.repeat(Effect.yieldNow, { times: 20 })

/** Lets `duration` pass, then the burst window of whatever came due. */
const pass = (duration: Duration.Input) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(duration)
    yield* settle
    yield* TestClock.adjust('5 seconds')
    yield* settle
  })

describe('notifier', () => {
  it.effect('pushes a session still blocked after 45 seconds (and the burst window)', () =>
    Effect.gen(function* () {
      const { push, apply } = yield* setup

      yield* apply(permission('ses_a'))
      yield* settle
      yield* TestClock.adjust('44 seconds')

      expect(yield* push.sent).toEqual([])

      yield* pass('1 second')

      expect(yield* push.sent).toEqual([
        {
          to: 'all',
          message: {
            title: 'Permission required',
            body: 'vltra · Session ses_a',
            tag: 'ses_a',
            url: '/?session=ses_a'
          }
        }
      ])
    })
  )

  it.effect('says nothing about an ask answered within the grace period', () =>
    Effect.gen(function* () {
      const { push, apply } = yield* setup

      yield* apply(permission('ses_a'))
      yield* settle
      yield* TestClock.adjust('20 seconds')
      yield* apply(VltraEvent.PermissionReplied({ requestID: 'per_ses_a' }))
      yield* pass('1 minute')

      expect(yield* push.sent).toEqual([])
    })
  )

  it.effect('sends sessions that come due together as one summary', () =>
    Effect.gen(function* () {
      const { push, apply } = yield* setup

      yield* apply(permission('ses_a'))
      yield* apply(permission('ses_b'))
      yield* settle
      yield* pass('1 minute')

      const sent = yield* push.sent

      expect(sent.map(item => item.message.title)).toEqual(['2 sessions need you'])
    })
  )

  it.effect('waits 2 minutes for a finished run, and skips it once opened', () =>
    Effect.gen(function* () {
      const { push, apply } = yield* setup
      const idle = baseTime + 5_000

      yield* apply(
        VltraEvent.ExecutionEnded({
          sessionID: 'ses_a',
          at: idle,
          outcome: 'succeeded',
          reason: undefined
        })
      )
      yield* apply(
        VltraEvent.ExecutionEnded({
          sessionID: 'ses_b',
          at: idle,
          outcome: 'succeeded',
          reason: undefined
        })
      )
      yield* settle
      yield* TestClock.adjust('1 minute')
      yield* apply(VltraEvent.Viewed({ sessionID: 'ses_b', idle }))
      yield* pass('2 minutes')

      expect((yield* push.sent).map(item => item.message)).toEqual([
        {
          title: 'Response ready',
          body: 'vltra · Session ses_a',
          tag: 'ses_a',
          url: '/?session=ses_a'
        }
      ])
    })
  )

  it.effect('never notifies about what was already waiting when it started', () =>
    Effect.gen(function* () {
      const push = yield* makeFakePush([{ id: 'phone', label: 'iPhone · app', createdAt: 0 }])
      const store = yield* makeVltraStore(webUrl)
      const blocked = applyEvent(working, permission('ses_a'))

      yield* notifyAttention.pipe(
        Effect.provideService(VltraStore, store),
        Effect.provide(push.layer),
        Effect.forkChild
      )
      yield* settle
      yield* store.commit(() => ({ connection, model: blocked }))
      yield* settle
      yield* pass('1 minute')

      expect(yield* push.sent).toEqual([])
    })
  )
})
