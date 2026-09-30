import { Clock, Duration, Effect, Layer, Option, Queue, Schedule, Stream } from 'effect'
import { eventSessionID, FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import { applyEvent, fromSnapshot } from '@/lib/data/fleet/model'
import type { FleetModel } from '@/lib/data/fleet/model'
import { FleetStore } from '@/lib/data/fleet/store'
import type { FleetConnection, SessionRecord } from '@/lib/data/fleet/types'
import { OpenCodeRequestError } from '@/lib/services/opencode/errors'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection } from '@/lib/services/opencode/service'

export type WatcherOptions = {
  /** Retry policy for failed connection attempts; restarts fresh after every drop. */
  readonly reconnect: Schedule.Schedule<unknown, unknown>
  /** Pause after an established connection drops, before reconnecting. */
  readonly dropDelay: Duration.Input
  /** How long to wait for the stream's `server.connected` marker. */
  readonly connectTimeout: Duration.Input
}

/** 0.5s, 1s, 2s, ... capped at 30s between attempts; never gives up. */
export const defaultWatcherOptions: WatcherOptions = {
  reconnect: Schedule.min([Schedule.exponential('500 millis'), Schedule.spaced('30 seconds')]),
  dropDelay: '250 millis',
  connectTimeout: '10 seconds'
}

const errorText = (error: { readonly message: string }) => error.message

const setConnection = (update: (connection: FleetConnection, now: number) => FleetConnection) =>
  Effect.gen(function* () {
    const store = yield* FleetStore
    const now = yield* Clock.currentTimeMillis

    yield* store.commit(view => ({ ...view, connection: update(view.connection, now) }))
  })

const setModel = (model: FleetModel) =>
  Effect.flatMap(FleetStore, store => store.commit(view => ({ ...view, model })))

const currentModel = Effect.flatMap(FleetStore, store => Effect.map(store.view, view => view.model))

/** Upsert a session (and any missing ancestors) read from OpenCode. */
const refreshSession = (connection: OpenCodeConnection, sessionID: string) =>
  Effect.gen(function* () {
    let model = yield* currentModel
    let next: string | undefined = sessionID

    for (let depth = 0; next !== undefined && depth < 5; depth += 1) {
      const found: Option.Option<SessionRecord> = yield* connection.session(next)

      if (Option.isNone(found)) break

      model = applyEvent(model, FleetEvent.SessionUpserted({ session: found.value }))

      const parentID: string | undefined = found.value.parentID

      next = parentID !== undefined && !model.sessions.has(parentID) ? parentID : undefined
    }

    yield* setModel(model)
  })

const applySignal = (connection: OpenCodeConnection, signal: OpenCodeSignal) =>
  OpenCodeSignal.$match(signal, {
    Connected: () => Effect.void,
    Apply: ({ event }) =>
      Effect.gen(function* () {
        const sessionID = eventSessionID(event)
        const known = yield* currentModel

        // Events can reference sessions outside the snapshot window; read them first.
        if (sessionID !== undefined && !known.sessions.has(sessionID)) {
          yield* refreshSession(connection, sessionID)
        }

        const model = yield* currentModel

        yield* setModel(applyEvent(model, event))
      }),
    RefreshSession: ({ sessionID }) => refreshSession(connection, sessionID),
    RefreshWorktrees: ({ projectID }) =>
      Effect.gen(function* () {
        const directories = yield* connection.worktrees(projectID)
        const model = yield* currentModel

        yield* setModel(applyEvent(model, FleetEvent.WorktreesLoaded({ projectID, directories })))
      }),
    Resync: () => Effect.flatMap(connection.snapshot, snapshot => setModel(fromSnapshot(snapshot)))
  })

/**
 * One connection cycle, following the resync rule: subscribe to `/api/event` first, wait until
 * the server confirms the subscription, load the snapshot, then apply the buffered and live
 * events. Fails while connecting; once connected, returns when the stream ends or fails.
 */
export const connectOnce = (options: WatcherOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const opencode = yield* OpenCode

      yield* setConnection((connection, now) => ({
        ...connection,
        status: 'connecting',
        since: now
      }))

      const connection = yield* opencode.connect
      const signals = yield* Stream.toQueue(connection.signals, { capacity: 'unbounded' })

      // Everything before the marker predates the subscription and is covered by the snapshot.
      yield* Queue.take(signals).pipe(
        Effect.repeat({ until: signal => OpenCodeSignal.$is('Connected')(signal) }),
        Effect.timeoutOrElse({
          duration: options.connectTimeout,
          orElse: () =>
            Effect.fail(
              new OpenCodeRequestError({
                operation: 'event.subscribe',
                message: 'Timed out waiting for the event stream'
              })
            )
        }),
        Effect.catchTag('Done', () =>
          Effect.fail(
            new OpenCodeRequestError({
              operation: 'event.subscribe',
              message: 'Event stream closed before it connected'
            })
          )
        )
      )

      const snapshot = yield* connection.snapshot
      const store = yield* FleetStore
      const connectedAt = yield* Clock.currentTimeMillis

      yield* store.commit(() => ({
        model: fromSnapshot(snapshot),
        connection: {
          status: 'connected',
          since: connectedAt,
          failures: 0,
          url: connection.url,
          version: connection.version
        }
      }))

      yield* Effect.logInfo('Connected to OpenCode', connection.url, connection.version)

      const ended = yield* Stream.fromQueue(signals).pipe(
        Stream.runForEach(signal => applySignal(connection, signal)),
        Effect.as('The OpenCode event stream ended'),
        Effect.catch(error => Effect.succeed(errorText(error)))
      )

      yield* Effect.logWarning('Disconnected from OpenCode', ended)

      yield* setConnection((current, now) => ({
        ...current,
        status: 'disconnected',
        since: now,
        failures: 0,
        error: ended
      }))
    })
  )

/**
 * The long-lived watcher: connect, stay in sync, and reconnect with backoff forever. Keeps the
 * last model on disconnect (marked `disconnected`) so clients can show stale rows.
 */
export const watchOpenCode = (options: WatcherOptions = defaultWatcherOptions) =>
  connectOnce(options).pipe(
    Effect.tapError(error =>
      Effect.andThen(
        Effect.logWarning('OpenCode connection failed', errorText(error)),
        setConnection((current, now) => ({
          ...current,
          status: 'disconnected',
          since: now,
          failures: current.failures + 1,
          error: errorText(error)
        }))
      )
    ),
    Effect.retry(options.reconnect),
    Effect.andThen(Effect.sleep(options.dropDelay)),
    Effect.forever
  )

/** Forks the watcher for the lifetime of the layer (the app's `ManagedRuntime`). */
export const FleetWatcherLive = (options: WatcherOptions = defaultWatcherOptions) =>
  Layer.effectDiscard(Effect.forkScoped(watchOpenCode(options)))
