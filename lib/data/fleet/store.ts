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
import { diffSnapshots, initialChange } from '@/lib/data/fleet/change'
import { emptyModel } from '@/lib/data/fleet/model'
import type { FleetModel } from '@/lib/data/fleet/model'
import { buildSnapshot } from '@/lib/data/fleet/snapshot'
import type { FleetChange, FleetConnection, FleetSnapshot, Launch } from '@/lib/data/fleet/types'

/**
 * The watcher's current view: connection status, model, the launcher's launches, and their
 * projected snapshot.
 */
export type FleetView = {
  readonly connection: FleetConnection
  readonly model: FleetModel
  readonly launches: ReadonlyArray<Launch>
  readonly snapshot: FleetSnapshot
}

export type FleetStoreOperations = {
  readonly view: Effect.Effect<FleetView>
  readonly snapshot: Effect.Effect<FleetSnapshot>
  /**
   * Replace connection and/or model, re-project the snapshot, and publish `fleet.changed` when
   * a client-visible row, count, or the connection changed.
   */
  readonly commit: (
    update: (view: FleetView) => {
      readonly connection: FleetConnection
      readonly model: FleetModel
    }
  ) => Effect.Effect<FleetView>
  /** Replace the launches (same projection and publishing as `commit`). */
  readonly updateLaunches: (
    update: (launches: ReadonlyArray<Launch>) => ReadonlyArray<Launch>
  ) => Effect.Effect<FleetView>
  /**
   * `fleet.changed` stream for one client: subscribes first, then emits an initial change with
   * current counts, then every later change. Scoped to the stream's lifetime.
   */
  readonly changes: Stream.Stream<FleetChange>
}

export class FleetStore extends Context.Service<FleetStore, FleetStoreOperations>()(
  '@fleet/FleetStore'
) {}

/** Base URL of OpenCode's own web UI, used for the "Open in OpenCode" deep link. */
export const openCodeWebUrl = Config.url('FLEET_OPENCODE_WEB_URL').pipe(
  Config.withDefault(new URL('https://box.tail129a86.ts.net:9446'))
)

/** Slow SSE consumers drop their oldest pending changes instead of growing without bound. */
const subscriberCapacity = 256

export const makeFleetStore = (
  webUrl: URL
): Effect.Effect<FleetStoreOperations, never, Scope.Scope> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis

    const connection: FleetConnection = { status: 'connecting', since: now, failures: 0 }

    const ref = yield* SubscriptionRef.make<FleetView>({
      connection,
      model: emptyModel,
      launches: [],
      snapshot: buildSnapshot(emptyModel, { connection, webUrl, now, launches: [] })
    })

    const pubsub = yield* Effect.acquireRelease(
      PubSub.sliding<FleetChange>(subscriberCapacity),
      PubSub.shutdown
    )

    const lock = yield* Semaphore.make(1)

    const project = (
      update: (view: FleetView) => Omit<FleetView, 'snapshot'>
    ): Effect.Effect<FleetView> =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const previous = yield* SubscriptionRef.get(ref)
          const next = update(previous)
          const at = yield* Clock.currentTimeMillis

          const view: FleetView = {
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

    const commit: FleetStoreOperations['commit'] = update =>
      project(view => {
        const next = update(view)

        return { connection: next.connection, model: next.model, launches: view.launches }
      })

    const updateLaunches: FleetStoreOperations['updateLaunches'] = update =>
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
      changes
    }
  })

export const FleetStoreLive = Layer.effect(
  FleetStore,
  Effect.gen(function* () {
    const webUrl = yield* openCodeWebUrl.pipe(Effect.orDie)

    return yield* makeFleetStore(webUrl)
  })
)
