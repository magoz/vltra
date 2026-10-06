import { Duration, Effect, Layer, Option, Queue, Stream } from 'effect'
import {
  attentionBetween,
  distinctSessions,
  graceFor,
  pushMessage,
  stillNeeded
} from '@/lib/data/fleet/notify'
import type { Attention, Notice } from '@/lib/data/fleet/notify'
import { FleetStore } from '@/lib/data/fleet/store'
import { Push } from '@/lib/services/push/service'

/** Notices that come due within this of the first go out with it, as one push. */
const burstWindow = Duration.seconds(5)

/** Waits out the grace period, then reads the fleet again: a notice if it still needs me. */
const afterGrace = (attention: Attention): Stream.Stream<Notice, never, FleetStore> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.sleep(graceFor(attention))

      const notice = stillNeeded(attention, yield* (yield* FleetStore).snapshot)

      return notice === undefined ? Stream.empty : Stream.make(notice)
    })
  )

/**
 * The notifier (DESIGN.md "Notifications"): every pair of consecutive snapshots gives the sessions
 * that started needing me; each is checked again after its grace period, and those still needing me
 * are pushed to every device, one push per burst. In memory only: a restart forgets pending checks
 * (and the first snapshot is the baseline), so it can miss, never repeat, a few seconds' worth.
 */
export const notifyAttention = Effect.gen(function* () {
  const store = yield* FleetStore
  const push = yield* Push
  const due = yield* Queue.unbounded<Notice>()

  yield* store.snapshots.pipe(
    Stream.zipWithPrevious,
    Stream.flatMap(([previous, next]) =>
      Option.match(previous, {
        onNone: () => Stream.empty,
        onSome: before => Stream.fromIterable(attentionBetween(before, next))
      })
    ),
    Stream.flatMap(afterGrace, { concurrency: 'unbounded' }),
    Stream.runForEach(notice => Queue.offer(due, notice)),
    Effect.forkScoped
  )

  // The first notice due opens a burst; whatever comes due within the window joins it.
  return yield* Effect.forever(
    Effect.gen(function* () {
      const first = yield* Queue.takeAll(due)

      yield* Effect.sleep(burstWindow)

      const message = pushMessage(distinctSessions([...first, ...(yield* Queue.clear(due))]))

      if (message !== undefined) yield* push.broadcast(message)
    })
  )
})

/** Forks the notifier for the lifetime of the runtime. */
export const NotifierLive = Layer.effectDiscard(
  Effect.forkScoped(
    notifyAttention.pipe(Effect.tapCause(cause => Effect.logError('Notifier stopped', cause)))
  )
)
