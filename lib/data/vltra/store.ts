import {
  Clock,
  Config,
  Context,
  Effect,
  Layer,
  PubSub,
  Semaphore,
  Stream,
  SubscriptionRef
} from 'effect'
import type { Scope } from 'effect'
import { diffSnapshots, initialChange } from '@/lib/data/vltra/change'
import { emptyModel } from '@/lib/data/vltra/model'
import type { VltraModel } from '@/lib/data/vltra/model'
import { buildSnapshot } from '@/lib/data/vltra/snapshot'
import type { VltraChange, VltraConnection, VltraSnapshot, Launch } from '@/lib/data/vltra/types'

/**
 * The watcher's current view: connection status, model, the launcher's launches, and their
 * projected snapshot.
 */
export type VltraView = {
  readonly connection: VltraConnection
  readonly model: VltraModel
  readonly launches: ReadonlyArray<Launch>
  readonly snapshot: VltraSnapshot
}

export type VltraStoreOperations = {
  readonly view: Effect.Effect<VltraView>
  readonly snapshot: Effect.Effect<VltraSnapshot>
  /**
   * Replace connection and/or model, re-project the snapshot, and publish `vltra.changed` when
   * a client-visible row, count, or the connection changed.
   */
  readonly commit: (
    update: (view: VltraView) => {
      readonly connection: VltraConnection
      readonly model: VltraModel
    }
  ) => Effect.Effect<VltraView>
  /** Replace the launches (same projection and publishing as `commit`). */
  readonly updateLaunches: (
    update: (launches: ReadonlyArray<Launch>) => ReadonlyArray<Launch>
  ) => Effect.Effect<VltraView>
  /**
   * `vltra.changed` stream for one client: subscribes first, then emits an initial change with
   * current counts, then every later change. Scoped to the stream's lifetime.
   */
  readonly changes: Stream.Stream<VltraChange>
  /** The current snapshot, then every new one (`notifier.ts` diffs consecutive ones). */
  readonly snapshots: Stream.Stream<VltraSnapshot>
}

export class VltraStore extends Context.Service<VltraStore, VltraStoreOperations>()(
  '@vltra/VltraStore'
) {}

/**
 * Base URL of OpenCode's own web UI, used for the chat iframe and "Open in OpenCode": Vltra's own
 * origin, which proxies it (`proxy.ts`).
 */
export const openCodeWebUrl = Config.url('VLTRA_OPENCODE_WEB_URL').pipe(
  Config.withDefault(new URL('https://vltra.localhost'))
)

/** Slow SSE consumers drop their oldest pending changes instead of growing without bound. */
const subscriberCapacity = 256

export const makeVltraStore = (
  webUrl: URL
): Effect.Effect<VltraStoreOperations, never, Scope.Scope> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis

    const connection: VltraConnection = { status: 'connecting', since: now, failures: 0 }

    const ref = yield* SubscriptionRef.make<VltraView>({
      connection,
      model: emptyModel,
      launches: [],
      snapshot: buildSnapshot(emptyModel, { connection, webUrl, now, launches: [] })
    })

    const pubsub = yield* Effect.acquireRelease(
      PubSub.sliding<VltraChange>(subscriberCapacity),
      PubSub.shutdown
    )

    const lock = yield* Semaphore.make(1)

    const project = (
      update: (view: VltraView) => Omit<VltraView, 'snapshot'>
    ): Effect.Effect<VltraView> =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const previous = yield* SubscriptionRef.get(ref)
          const next = update(previous)
          const at = yield* Clock.currentTimeMillis

          const view: VltraView = {
            ...next,
            snapshot: buildSnapshot(next.model, {
              connection: next.connection,
              webUrl,
              now: at,
              launches: next.launches
            })
          }

          yield* SubscriptionRef.set(ref, view)

          const change = diffSnapshots(previous.snapshot, view.snapshot)

          if (change !== undefined) yield* PubSub.publish(pubsub, change)

          return view
        })
      )

    const commit: VltraStoreOperations['commit'] = update =>
      project(view => {
        const next = update(view)

        return { connection: next.connection, model: next.model, launches: view.launches }
      })

    const updateLaunches: VltraStoreOperations['updateLaunches'] = update =>
      project(view => ({
        connection: view.connection,
        model: view.model,
        launches: update(view.launches)
      }))

    const changes = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(pubsub)
        const current = yield* SubscriptionRef.get(ref)

        return Stream.concat(
          Stream.make(initialChange(current.snapshot)),
          Stream.fromSubscription(subscription)
        )
      })
    )

    return {
      view: SubscriptionRef.get(ref),
      snapshot: Effect.map(SubscriptionRef.get(ref), view => view.snapshot),
      commit,
      updateLaunches,
      changes,
      snapshots: Stream.map(SubscriptionRef.changes(ref), view => view.snapshot)
    }
  })

export const VltraStoreLive = Layer.effect(
  VltraStore,
  Effect.gen(function* () {
    const webUrl = yield* openCodeWebUrl.pipe(Effect.orDie)

    return yield* makeVltraStore(webUrl)
  })
)
