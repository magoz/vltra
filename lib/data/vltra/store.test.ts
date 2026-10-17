import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Stream } from 'effect'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, fromSnapshot } from '@/lib/data/vltra/model'
import { makeVltraStore } from '@/lib/data/vltra/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const model = fromSnapshot({ ...emptySnapshot, sessions: [sessionRecord('ses_a')] }, baseTime)

describe('vltra store', () => {
  it.effect('streams an initial change, then only client-visible changes', () =>
    Effect.gen(function* () {
      const store = yield* makeVltraStore(webUrl)

      const collected = yield* store.changes.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild
      )

      yield* Effect.repeat(Effect.yieldNow, { times: 20 })

      const connected = { status: 'connected' as const, since: baseTime, failures: 0 }

      yield* store.commit(() => ({ connection: connected, model }))
      // No visible change: must not publish.
      yield* store.commit(view => view)

      yield* store.commit(view => ({
        ...view,
        model: applyEvent(view.model, VltraEvent.ExecutionStarted({ sessionID: 'ses_a', at: 1 }))
      }))

      const changes = yield* Fiber.join(collected)

      expect(changes.map(change => change.initial)).toEqual([true, false, false])
      expect(changes[0]?.connection.status).toBe('connecting')
      expect(changes[1]?.rows.map(row => [row.id, row.state])).toEqual([['ses_a', 'handled']])
      expect(changes[2]?.rows.map(row => [row.id, row.state])).toEqual([['ses_a', 'working']])
      expect(changes[2]?.counts.working).toBe(1)
    })
  )

  it.effect('serves the latest projected snapshot', () =>
    Effect.gen(function* () {
      const store = yield* makeVltraStore(webUrl)

      yield* store.commit(view => ({ ...view, model }))

      const snapshot = yield* store.snapshot

      expect(snapshot.counts.handled).toBe(1)
      expect(snapshot.projects[0]?.worktrees[0]?.rows[0]?.id).toBe('ses_a')
    })
  )
})
