import { Deferred, Effect, Layer, Option, Queue, Ref, Stream } from 'effect'
import type { Cause } from 'effect'
import { OpenCodeSignal } from '@/lib/data/fleet/events'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import type { SessionRecord } from '@/lib/data/fleet/types'
import { OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection } from '@/lib/services/opencode/service'

/** A call Fleet made against the fake, for assertions. */
export type FakeCall =
  | { readonly op: 'view'; readonly sessionID: string; readonly idle: number }
  | { readonly op: 'replyPermission'; readonly sessionID: string; readonly requestID: string }
  | { readonly op: 'replyForm'; readonly sessionID: string; readonly formID: string }
  | { readonly op: 'prompt'; readonly sessionID: string; readonly text: string }
  | { readonly op: 'interrupt'; readonly sessionID: string }

export type FakeOpenCode = {
  readonly layer: Layer.Layer<OpenCode>
  /** Replace what the next snapshot (and `session(id)` reads) return. */
  readonly setSnapshot: (snapshot: OpenCodeSnapshot) => Effect.Effect<void>
  /** Fail the next `count` connection attempts. */
  readonly failConnects: (count: number) => Effect.Effect<void>
  /** Hold the next snapshot until `release` is called. */
  readonly holdSnapshot: Effect.Effect<{ readonly release: Effect.Effect<void> }>
  /** Push a signal to the current connection's event stream. */
  readonly emit: (signal: OpenCodeSignal) => Effect.Effect<void>
  /** End the current event stream (server went away). */
  readonly disconnect: Effect.Effect<void>
  readonly connectAttempts: Effect.Effect<number>
  readonly snapshotLoads: Effect.Effect<number>
  readonly calls: Effect.Effect<ReadonlyArray<FakeCall>>
}

export const emptySnapshot: OpenCodeSnapshot = {
  sessions: [],
  running: [],
  permissions: [],
  forms: [],
  projects: [],
  worktrees: []
}

/** In-memory OpenCode behind the real `OpenCode` service seam. */
export const makeFakeOpenCode = (initial: OpenCodeSnapshot = emptySnapshot) =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.make(initial)
    const failures = yield* Ref.make(0)
    const attempts = yield* Ref.make(0)
    const loads = yield* Ref.make(0)
    const calls = yield* Ref.make<ReadonlyArray<FakeCall>>([])
    const gate = yield* Ref.make<Option.Option<Deferred.Deferred<void>>>(Option.none())

    const current = yield* Ref.make<Option.Option<Queue.Queue<OpenCodeSignal, Cause.Done>>>(
      Option.none()
    )

    const record = (call: FakeCall) => Ref.update(calls, list => [...list, call])

    const readSession = (sessionID: string) =>
      Effect.map(Ref.get(snapshot), value =>
        Option.fromNullishOr(value.sessions.find(session => session.id === sessionID))
      )

    const loadSnapshot = Effect.gen(function* () {
      const held = yield* Ref.getAndSet(gate, Option.none())

      if (Option.isSome(held)) yield* Deferred.await(held.value)

      yield* Ref.update(loads, count => count + 1)

      return yield* Ref.get(snapshot)
    })

    const connection = (queue: Queue.Queue<OpenCodeSignal, Cause.Done>): OpenCodeConnection => ({
      url: 'http://fake.opencode',
      version: 'fake',
      signals: Stream.concat(Stream.make(OpenCodeSignal.Connected()), Stream.fromQueue(queue)),
      snapshot: loadSnapshot,
      session: readSession,
      worktrees: projectID =>
        Effect.map(
          Ref.get(snapshot),
          value => value.worktrees.find(entry => entry.projectID === projectID)?.directories ?? []
        ),
      view: ({ sessionID, idle }) =>
        Effect.andThen(
          record({ op: 'view', sessionID, idle }),
          Ref.update(snapshot, value => ({
            ...value,
            sessions: value.sessions.map((session): SessionRecord =>
              session.id === sessionID
                ? { ...session, viewed: Math.max(session.viewed ?? idle, idle) }
                : session
            )
          }))
        ),
      replyPermission: ({ sessionID, requestID }) =>
        record({ op: 'replyPermission', sessionID, requestID }),
      replyForm: ({ sessionID, formID }) => record({ op: 'replyForm', sessionID, formID }),
      prompt: ({ sessionID, text }) => record({ op: 'prompt', sessionID, text }),
      interrupt: ({ sessionID }) => Effect.as(record({ op: 'interrupt', sessionID }), true)
    })

    const layer = Layer.succeed(OpenCode, {
      connect: Effect.gen(function* () {
        yield* Ref.update(attempts, count => count + 1)

        const remaining = yield* Ref.getAndUpdate(failures, count => Math.max(0, count - 1))

        if (remaining > 0) {
          return yield* new OpenCodeUnavailableError({ message: 'fake: connection refused' })
        }

        const queue = yield* Queue.unbounded<OpenCodeSignal, Cause.Done>()

        yield* Ref.set(current, Option.some(queue))

        return connection(queue)
      })
    })

    const withQueue = (
      use: (queue: Queue.Queue<OpenCodeSignal, Cause.Done>) => Effect.Effect<void>
    ) =>
      Effect.flatMap(Ref.get(current), queue =>
        Option.match(queue, { onNone: () => Effect.void, onSome: use })
      )

    const fake: FakeOpenCode = {
      layer,
      setSnapshot: value => Ref.set(snapshot, value),
      failConnects: count => Ref.set(failures, count),
      holdSnapshot: Effect.gen(function* () {
        const deferred = yield* Deferred.make<void>()

        yield* Ref.set(gate, Option.some(deferred))

        return { release: Effect.asVoid(Deferred.succeed(deferred, undefined)) }
      }),
      emit: signal => withQueue(queue => Effect.asVoid(Queue.offer(queue, signal))),
      disconnect: withQueue(queue => Effect.asVoid(Queue.end(queue))),
      connectAttempts: Ref.get(attempts),
      snapshotLoads: Ref.get(loads),
      calls: Ref.get(calls)
    }

    return fake
  })
