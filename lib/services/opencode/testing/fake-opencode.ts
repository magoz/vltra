import type { Session } from '@opencode/client/effect'
import { Clock, Deferred, Effect, Layer, Option, Queue, Ref, Stream } from 'effect'
import type { Cause } from 'effect'
import { FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import type { FileChange, InterruptReason, SessionRecord, Transcript } from '@/lib/data/fleet/types'
import {
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'
import { fleetHandled, withFleetHandled } from '@/lib/services/opencode/mapping'
import { OpenCode } from '@/lib/services/opencode/service'
import type {
  ActionError,
  OpenCodeConnection,
  RejectableError,
  ResolvedLocation
} from '@/lib/services/opencode/service'

/** A call Fleet made against the fake, for assertions. */
export type FakeCall =
  | { readonly op: 'view'; readonly sessionID: string; readonly idle: number }
  | { readonly op: 'setHandled'; readonly sessionID: string; readonly handled: number | undefined }
  | { readonly op: 'interruptReason'; readonly sessionID: string }
  | { readonly op: 'prompt'; readonly sessionID: string; readonly text: string }
  | { readonly op: 'transcript'; readonly sessionID: string; readonly assistantOnly: boolean }
  | { readonly op: 'diff'; readonly sessionID: string }
  | { readonly op: 'resolveLocation'; readonly directory: string }
  | { readonly op: 'createWorktree'; readonly projectID: string; readonly name: string }
  | { readonly op: 'removeWorktree'; readonly projectID: string; readonly directory: string }
  | { readonly op: 'createSession'; readonly directory: string; readonly title: string | undefined }
  | { readonly op: 'generateText'; readonly prompt: string }

/** How the fake answers the launcher's calls; each defaults to a quick success (text: a refusal). */
export type FakeLauncherBehavior = {
  readonly createWorktree: (input: {
    readonly projectID: string
    readonly name: string
  }) => Effect.Effect<string, RejectableError>
  readonly removeWorktree: (input: {
    readonly projectID: string
    readonly directory: string
  }) => Effect.Effect<void, RejectableError>
  readonly createSession: (input: {
    readonly directory: string
    readonly title: string | undefined
  }) => Effect.Effect<void, RejectableError>
  readonly prompt: (input: {
    readonly sessionID: string
    readonly text: string
  }) => Effect.Effect<void, ActionError>
  readonly generateText: (prompt: string) => Effect.Effect<string, RejectableError>
}

const defaultLauncherBehavior: FakeLauncherBehavior = {
  createWorktree: ({ name }) => Effect.succeed(`/worktrees/${name}`),
  removeWorktree: () => Effect.void,
  createSession: () => Effect.void,
  prompt: () => Effect.void,
  generateText: () =>
    Effect.fail(new OpenCodeRequestError({ operation: 'generate.text', message: 'fake: no model' }))
}

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
  /** Transcripts and diffs served per session (missing: empty transcript, no files). */
  readonly setTranscript: (sessionID: string, transcript: Transcript) => Effect.Effect<void>
  readonly setDiff: (
    sessionID: string,
    files: ReadonlyArray<FileChange> | 'fail'
  ) => Effect.Effect<void>
  /**
   * Replace a session's raw metadata (as OpenCode stores it); its record's `handled` follows. By
   * default a session's metadata is just its record's handled marker.
   */
  readonly setMetadata: (sessionID: string, metadata: Session.Metadata) => Effect.Effect<void>
  readonly metadata: (sessionID: string) => Effect.Effect<Session.Metadata | undefined>
  /** What the session log says about the latest run's interruption (default: nothing). */
  readonly setInterruptReason: (sessionID: string, reason: InterruptReason) => Effect.Effect<void>
  /** Override how the launcher's calls answer. */
  readonly setLauncherBehavior: (behavior: Partial<FakeLauncherBehavior>) => Effect.Effect<void>
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
    const transcripts = yield* Ref.make<ReadonlyMap<string, Transcript>>(new Map())

    const diffs = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<FileChange> | 'fail'>>(
      new Map()
    )

    const metadata = yield* Ref.make<ReadonlyMap<string, Session.Metadata>>(new Map())
    const interrupts = yield* Ref.make<ReadonlyMap<string, InterruptReason>>(new Map())
    const launcher = yield* Ref.make(defaultLauncherBehavior)
    const created = yield* Ref.make(0)

    const current = yield* Ref.make<Option.Option<Queue.Queue<OpenCodeSignal, Cause.Done>>>(
      Option.none()
    )

    const record = (call: FakeCall) => Ref.update(calls, list => [...list, call])

    const readSession = (sessionID: string) =>
      Effect.map(Ref.get(snapshot), value =>
        Option.fromNullishOr(value.sessions.find(session => session.id === sessionID))
      )

    const withQueue = (
      use: (queue: Queue.Queue<OpenCodeSignal, Cause.Done>) => Effect.Effect<void>
    ) =>
      Effect.flatMap(Ref.get(current), queue =>
        Option.match(queue, { onNone: () => Effect.void, onSome: use })
      )

    const emit = (signal: OpenCodeSignal) =>
      withQueue(queue => Effect.asVoid(Queue.offer(queue, signal)))

    const patchSession = (sessionID: string, patch: Partial<SessionRecord>) =>
      Ref.update(snapshot, value => ({
        ...value,
        sessions: value.sessions.map((session): SessionRecord =>
          session.id === sessionID ? { ...session, ...patch } : session
        )
      }))

    const storeMetadata = (sessionID: string, next: Session.Metadata) =>
      Effect.andThen(
        Ref.update(metadata, map => new Map(map).set(sessionID, next)),
        patchSession(sessionID, { handled: fleetHandled(next) })
      )

    const metadataOf = (session: SessionRecord) =>
      Effect.map(
        Ref.get(metadata),
        map => map.get(session.id) ?? withFleetHandled(undefined, session.handled)
      )

    /** Like OpenCode: replace the whole object, then emit `session.metadata.updated`. */
    const setHandled = (sessionID: string, handled: number | undefined) =>
      Effect.gen(function* () {
        yield* record({ op: 'setHandled', sessionID, handled })

        const found = yield* readSession(sessionID)

        if (Option.isNone(found)) return yield* new SessionNotFoundError({ sessionID })

        const next = withFleetHandled(yield* metadataOf(found.value), handled)

        yield* storeMetadata(sessionID, next)

        yield* emit(
          OpenCodeSignal.Apply({
            event: FleetEvent.HandledChanged({ sessionID, handled: fleetHandled(next) })
          })
        )
      })

    const loadSnapshot = Effect.gen(function* () {
      const held = yield* Ref.getAndSet(gate, Option.none())

      if (Option.isSome(held)) yield* Deferred.await(held.value)

      yield* Ref.update(loads, count => count + 1)

      return yield* Ref.get(snapshot)
    })

    /** Like `location.get`: the known project containing the directory, else a new one. */
    const locate = (directory: string) =>
      Effect.gen(function* () {
        const known = (yield* Ref.get(snapshot)).projects.find(
          project =>
            directory === project.directory || directory.startsWith(`${project.directory}/`)
        )

        if (known !== undefined) {
          const location: ResolvedLocation = {
            directory,
            projectID: known.id,
            projectDirectory: known.directory
          }

          return location
        }

        const projectID = `prj_${directory.split('/').findLast(part => part !== '') ?? 'root'}`

        yield* Ref.update(snapshot, value => ({
          ...value,
          projects: [...value.projects, { id: projectID, directory }]
        }))

        const location: ResolvedLocation = { directory, projectID, projectDirectory: directory }

        return location
      })

    const resolveLocation = (directory: string) =>
      Effect.andThen(record({ op: 'resolveLocation', directory }), locate(directory))

    /** Like `session.create`: a new, never-run session in `directory`, readable afterwards. */
    const createSession = (input: { readonly directory: string; readonly title?: string }) =>
      Effect.gen(function* () {
        yield* record({ op: 'createSession', directory: input.directory, title: input.title })
        yield* Effect.flatMap(Ref.get(launcher), behavior =>
          behavior.createSession({ directory: input.directory, title: input.title })
        )

        const count = yield* Ref.updateAndGet(created, value => value + 1)
        const location = yield* locate(input.directory)

        const session: SessionRecord = {
          id: `ses_created_${count}`,
          projectID: location.projectID,
          directory: input.directory,
          title: input.title,
          cost: 0,
          created: yield* Clock.currentTimeMillis
        }

        yield* Ref.update(snapshot, value => ({ ...value, sessions: [...value.sessions, session] }))

        return session
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
      setHandled: ({ sessionID, handled }) => setHandled(sessionID, handled),
      interruptReason: sessionID =>
        Effect.andThen(
          record({ op: 'interruptReason', sessionID }),
          Effect.map(Ref.get(interrupts), map => Option.fromNullishOr(map.get(sessionID)))
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
      prompt: ({ sessionID, text }) =>
        Effect.andThen(
          record({ op: 'prompt', sessionID, text }),
          Effect.flatMap(Ref.get(launcher), behavior => behavior.prompt({ sessionID, text }))
        ),
      transcript: ({ sessionID, assistantOnly }) =>
        Effect.andThen(
          record({ op: 'transcript', sessionID, assistantOnly }),
          Effect.map(
            Ref.get(transcripts),
            (map): Transcript => map.get(sessionID) ?? { entries: [], answer: undefined }
          )
        ),
      diff: ({ sessionID }) =>
        Effect.andThen(
          record({ op: 'diff', sessionID }),
          Effect.flatMap(Ref.get(diffs), map => {
            const files = map.get(sessionID) ?? []

            return files === 'fail'
              ? Effect.fail(
                  new OpenCodeRequestError({ operation: 'session.diff', message: 'fake: no diff' })
                )
              : Effect.succeed(files)
          })
        ),
      resolveLocation,
      createWorktree: ({ projectID, name }) =>
        Effect.andThen(
          record({ op: 'createWorktree', projectID, name }),
          Effect.flatMap(Ref.get(launcher), behavior =>
            behavior.createWorktree({ projectID, name })
          )
        ),
      removeWorktree: ({ projectID, directory }) =>
        Effect.andThen(
          record({ op: 'removeWorktree', projectID, directory }),
          Effect.flatMap(Ref.get(launcher), behavior =>
            behavior.removeWorktree({ projectID, directory })
          )
        ),
      createSession: ({ directory, title }) =>
        createSession(title === undefined ? { directory } : { directory, title }),
      generateText: prompt =>
        Effect.andThen(
          record({ op: 'generateText', prompt }),
          Effect.flatMap(Ref.get(launcher), behavior => behavior.generateText(prompt))
        )
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

    const fake: FakeOpenCode = {
      layer,
      setSnapshot: value => Ref.set(snapshot, value),
      failConnects: count => Ref.set(failures, count),
      holdSnapshot: Effect.gen(function* () {
        const deferred = yield* Deferred.make<void>()

        yield* Ref.set(gate, Option.some(deferred))

        return { release: Effect.asVoid(Deferred.succeed(deferred, undefined)) }
      }),
      emit,
      disconnect: withQueue(queue => Effect.asVoid(Queue.end(queue))),
      connectAttempts: Ref.get(attempts),
      snapshotLoads: Ref.get(loads),
      calls: Ref.get(calls),
      setTranscript: (sessionID, transcript) =>
        Ref.update(transcripts, map => new Map(map).set(sessionID, transcript)),
      setDiff: (sessionID, files) => Ref.update(diffs, map => new Map(map).set(sessionID, files)),
      setMetadata: storeMetadata,
      metadata: sessionID =>
        Effect.flatMap(readSession(sessionID), found =>
          Option.match(found, {
            onNone: () => Effect.succeed(undefined),
            onSome: metadataOf
          })
        ),
      setInterruptReason: (sessionID, reason) =>
        Ref.update(interrupts, map => new Map(map).set(sessionID, reason)),
      setLauncherBehavior: behavior =>
        Ref.update(launcher, current => ({ ...current, ...behavior }))
    }

    return fake
  })
