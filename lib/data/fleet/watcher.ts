import { Clock, Duration, Effect, Layer, Option, Queue, Ref, Schedule, Stream } from 'effect'
import { eventSessionID, FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import {
  applyEvent,
  fromSnapshot,
  isFolderGone,
  sessionDirectories,
  snapshotDirectories,
  uncheckedDirectories
} from '@/lib/data/fleet/model'
import type { FleetModel, OpenCodeSnapshot, TrackedSession } from '@/lib/data/fleet/model'
import { isRoot } from '@/lib/data/fleet/snapshot'
import { isHandled } from '@/lib/data/fleet/state'
import { FleetStore } from '@/lib/data/fleet/store'
import type { FleetView } from '@/lib/data/fleet/store'
import type { FleetConnection, InterruptReason, SessionRecord } from '@/lib/data/fleet/types'
import { Directories } from '@/lib/services/directories/service'
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
  /**
   * How often to re-project the snapshot so time-based counts (`stuck`) stay current, and to
   * re-check session folders (worktrees are deleted after merge, even under live sessions).
   */
  readonly recount: Duration.Input
}

/** 0.5s, 1s, 2s, ... capped at 30s between attempts; never gives up. */
export const defaultWatcherOptions: WatcherOptions = {
  reconnect: Schedule.min([Schedule.exponential('500 millis'), Schedule.spaced('30 seconds')]),
  dropDelay: '250 millis',
  connectTimeout: '10 seconds',
  recount: '1 minute'
}

/**
 * Interrupt reasons per run (`sessionID:idle`), for the life of the watcher (one per process):
 * from live events, or read once from the session log (none: the log names no reason).
 */
export type RunReasons = Ref.Ref<ReadonlyMap<string, Option.Option<InterruptReason>>>

const runKey = (sessionID: string, idle: number) => `${sessionID}:${idle}`

const errorText = (error: { readonly message: string }) => error.message

const setConnection = (update: (connection: FleetConnection, now: number) => FleetConnection) =>
  Effect.gen(function* () {
    const store = yield* FleetStore
    const now = yield* Clock.currentTimeMillis

    yield* store.commit(view => ({ ...view, connection: update(view.connection, now) }))
  })

const setModel = (model: FleetModel) =>
  Effect.flatMap(FleetStore, store => store.commit(view => ({ ...view, model })))

/** Applies one event atomically (other fibers commit too: interrupt recovery). */
const applyToModel = (event: FleetEvent) =>
  Effect.flatMap(FleetStore, store =>
    store.commit(view => ({ ...view, model: applyEvent(view.model, event) }))
  )

const currentModel = Effect.flatMap(FleetStore, store => Effect.map(store.view, view => view.model))

/** Which of `directories` are gone from disk. */
const checkDirectories = (directories: Iterable<string>) =>
  Effect.flatMap(Directories, service => service.check(directories))

/** A fresh model for a snapshot, with its sessions' folders checked first. */
const modelFromSnapshot = (snapshot: OpenCodeSnapshot) =>
  Effect.gen(function* () {
    const directoryGone = yield* checkDirectories(snapshotDirectories(snapshot))
    const now = yield* Clock.currentTimeMillis

    return { model: fromSnapshot(snapshot, now, directoryGone), now }
  })

/** Checks the folders of sessions the model has not checked yet (new or moved sessions). */
const checkNewDirectories = Effect.gen(function* () {
  const unchecked = uncheckedDirectories(yield* currentModel)

  if (unchecked.length === 0) return

  const directories = yield* checkDirectories(unchecked)

  yield* applyToModel(FleetEvent.DirectoriesChecked({ directories }))
})

/** Upsert a session (and any missing ancestors) read from OpenCode. */
const refreshSession = (connection: OpenCodeConnection, sessionID: string) =>
  Effect.gen(function* () {
    let next: string | undefined = sessionID

    for (let depth = 0; next !== undefined && depth < 5; depth += 1) {
      const found: Option.Option<SessionRecord> = yield* connection.session(next)

      if (Option.isNone(found)) break

      const view: FleetView = yield* applyToModel(
        FleetEvent.SessionUpserted({ session: found.value })
      )

      const parentID: string | undefined = found.value.parentID

      next = parentID !== undefined && !view.model.sessions.has(parentID) ? parentID : undefined
    }

    yield* checkNewDirectories
  })

/**
 * A root session's run was stopped by the user (any client's Stop): mark that run handled. The
 * stored `time.idle` is read fresh (the event time can differ from it by OpenCode's +1).
 */
const handleUserInterrupt = (connection: OpenCodeConnection, sessionID: string) =>
  Effect.gen(function* () {
    const found = yield* connection.session(sessionID)

    if (Option.isNone(found)) return

    const info = found.value

    if (info.outcome !== 'interrupted' || info.idle === undefined || isHandled(info)) return

    yield* connection.setHandled({ sessionID, handled: info.idle })
    yield* Effect.logInfo('Marked a user-interrupted run handled', sessionID, info.idle)
  }).pipe(
    Effect.catch(error =>
      Effect.logWarning('Could not mark an interrupted run handled', sessionID, error.message)
    )
  )

/** A root session whose folder still exists (OpenCode cannot write to one whose folder is gone). */
const writableRoot = (model: FleetModel, sessionID: string): TrackedSession | undefined => {
  const session = model.sessions.get(sessionID)

  return session !== undefined && isRoot(model, session) && !isFolderGone(model, session)
    ? session
    : undefined
}

/** After an interruption event: remember its reason for the run, auto-handle a user's Stop. */
const afterInterrupt = (
  connection: OpenCodeConnection,
  reasons: RunReasons,
  sessionID: string,
  reason: InterruptReason
) =>
  Effect.gen(function* () {
    const model = yield* currentModel
    const session = model.sessions.get(sessionID)
    const idle = session?.info.idle

    if (session?.interrupt !== reason || idle === undefined) return

    yield* Ref.update(reasons, map =>
      new Map(map).set(runKey(sessionID, idle), Option.some(reason))
    )

    if (reason === 'user' && writableRoot(model, sessionID) !== undefined) {
      yield* handleUserInterrupt(connection, sessionID)
    }
  })

const afterEvent = (connection: OpenCodeConnection, reasons: RunReasons, event: FleetEvent) =>
  FleetEvent.$is('ExecutionEnded')(event) &&
  event.outcome === 'interrupted' &&
  event.reason !== undefined &&
  event.reason !== 'shutdown'
    ? afterInterrupt(connection, reasons, event.sessionID, event.reason)
    : Effect.void

/**
 * Finished root sessions interrupted for a reason Fleet never saw (it was down). Sessions whose
 * folder is gone are handled already.
 */
const missingReason = (model: FleetModel, session: TrackedSession) =>
  isRoot(model, session) &&
  !isFolderGone(model, session) &&
  !session.running &&
  session.info.outcome === 'interrupted' &&
  !isHandled(session.info) &&
  session.interrupt === undefined

/** The run's reason: remembered, else read once from the session log and remembered. */
const runReason = (
  connection: OpenCodeConnection,
  reasons: RunReasons,
  sessionID: string,
  idle: number
) =>
  Effect.gen(function* () {
    const key = runKey(sessionID, idle)
    const known = (yield* Ref.get(reasons)).get(key)

    if (known !== undefined) return known

    const read = yield* connection.interruptReason(sessionID)

    yield* Ref.update(reasons, map => new Map(map).set(key, read))

    return read
  })

const recoverRun = (
  connection: OpenCodeConnection,
  reasons: RunReasons,
  sessionID: string,
  idle: number
) =>
  Effect.gen(function* () {
    const reason = yield* runReason(connection, reasons, sessionID, idle)

    if (Option.isNone(reason)) return

    yield* applyToModel(FleetEvent.InterruptRecovered({ sessionID, idle, reason: reason.value }))

    if (reason.value === 'user') yield* handleUserInterrupt(connection, sessionID)
  }).pipe(
    Effect.catch(error =>
      Effect.logWarning('Could not recover an interrupt reason', sessionID, error.message)
    )
  )

/**
 * Recovers interrupt reasons Fleet missed while it was not listening, from each session's log
 * (at most once per run per process), and marks runs the user stopped handled.
 */
export const recoverInterrupts = (connection: OpenCodeConnection, reasons: RunReasons) =>
  Effect.gen(function* () {
    const model = yield* currentModel

    const runs = Array.from(model.sessions.values()).flatMap(session =>
      missingReason(model, session) && session.info.idle !== undefined
        ? [{ sessionID: session.info.id, idle: session.info.idle }]
        : []
    )

    yield* Effect.forEach(runs, run => recoverRun(connection, reasons, run.sessionID, run.idle), {
      concurrency: 2,
      discard: true
    })
  })

const applySignal = (
  connection: OpenCodeConnection,
  reasons: RunReasons,
  recheck: Queue.Queue<void>,
  signal: OpenCodeSignal
) =>
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

        yield* applyToModel(event)
        yield* afterEvent(connection, reasons, event)
      }),
    RefreshSession: ({ sessionID }) => refreshSession(connection, sessionID),
    RefreshWorktrees: ({ projectID }) =>
      Effect.flatMap(connection.worktrees(projectID), directories =>
        applyToModel(FleetEvent.WorktreesLoaded({ projectID, directories }))
      ),
    Resync: () =>
      Effect.gen(function* () {
        const snapshot = yield* connection.snapshot
        const { model } = yield* modelFromSnapshot(snapshot)

        yield* setModel(model)
        yield* Queue.offer(recheck, undefined)
      })
  })

/**
 * One connection cycle, following the resync rule: subscribe to `/api/event` first, wait until
 * the server confirms the subscription, load the snapshot, then apply the buffered and live
 * events. Fails while connecting; once connected, returns when the stream ends or fails.
 */
export const connectOnce = (options: WatcherOptions, reasons: RunReasons) =>
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
      const { model, now: connectedAt } = yield* modelFromSnapshot(snapshot)

      yield* store.commit(() => ({
        model,
        connection: {
          status: 'connected',
          since: connectedAt,
          failures: 0,
          url: connection.url,
          version: connection.version
        }
      }))

      yield* Effect.logInfo('Connected to OpenCode', connection.url, connection.version)

      // One recovery pass at a time, after every snapshot; triggers coalesce while one runs.
      const recheck = yield* Queue.sliding<void>(1)

      yield* Effect.forkScoped(
        Stream.fromQueue(recheck).pipe(
          Stream.runForEach(() => recoverInterrupts(connection, reasons))
        )
      )

      yield* Queue.offer(recheck, undefined)

      const ended = yield* Stream.fromQueue(signals).pipe(
        Stream.runForEach(signal => applySignal(connection, reasons, recheck, signal)),
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
  Effect.gen(function* () {
    const reasons: RunReasons = yield* Ref.make<
      ReadonlyMap<string, Option.Option<InterruptReason>>
    >(new Map())

    return yield* connectOnce(options, reasons).pipe(
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
  })

/**
 * One recount tick: re-check every session folder, then re-project the snapshot (`stuck`, quiet
 * for too long, changes with time alone; a deleted folder makes its session handled).
 */
const recount = Effect.gen(function* () {
  const store = yield* FleetStore
  const directories = yield* checkDirectories(sessionDirectories((yield* store.view).model))

  yield* store.commit(view => ({
    ...view,
    model: applyEvent(view.model, FleetEvent.DirectoriesChecked({ directories }))
  }))
})

const recountForever = (every: Duration.Input) =>
  recount.pipe(Effect.repeat(Schedule.spaced(every)), Effect.asVoid)

/** Forks the watcher for the lifetime of the layer (the app's `ManagedRuntime`). */
export const FleetWatcherLive = (options: WatcherOptions = defaultWatcherOptions) =>
  Layer.effectDiscard(
    Effect.andThen(
      Effect.forkScoped(watchOpenCode(options)),
      Effect.forkScoped(recountForever(options.recount))
    )
  )
