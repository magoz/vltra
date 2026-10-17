import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Option, Schedule } from 'effect'
import { markHandled, markViewed, reopen } from '@/lib/data/vltra/actions'
import { loadSessionSummary } from '@/lib/data/vltra/session-detail'
import { snapshotRows } from '@/lib/data/vltra/snapshot'
import { VltraStore, VltraStoreLive } from '@/lib/data/vltra/store'
import type { VltraRow, VltraSnapshot } from '@/lib/data/vltra/types'
import { VltraWatcherLive } from '@/lib/data/vltra/watcher'
import type { WatcherOptions } from '@/lib/data/vltra/watcher'
import { DirectoriesLive } from '@/lib/services/directories/live-layer'
import { OpenCode } from '@/lib/services/opencode/service'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'
import {
  findOpenCode,
  requiredVersion,
  startOpenCodeServer
} from '@/lib/services/opencode/testing/opencode-server'
import type { JsonValue, OpenCodeServer } from '@/lib/services/opencode/testing/opencode-server'

// Runs Vltra against a real, isolated, throwaway `opencode serve` (v2.0.22). No model is ever
// called: sessions use an unavailable model so prompts fail fast, and outbound HTTP is blocked.

const binary = findOpenCode()

// Belt and braces: even if some code path ignored the test's config, discovery must never find
// the live service's registration file from this process.
process.env.OPENCODE_SERVICE_FILE = '/nonexistent/vltra-integration/service.json'

if (!binary.available) {
  console.warn(`Skipping OpenCode integration tests: ${binary.reason}`)
}

// A long pause after a drop leaves time to change OpenCode while Vltra is not listening.
const options: WatcherOptions = {
  reconnect: Schedule.min([Schedule.exponential('100 millis'), Schedule.spaced('1 second')]),
  dropDelay: '6 seconds',
  connectTimeout: '10 seconds',
  recount: '1 minute'
}

const testConfig = (server: OpenCodeServer) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: { OPENCODE_URL: server.url, OPENCODE_PASSWORD: server.password }
    })
  )

const vltraLayer = (server: OpenCodeServer, watcher: WatcherOptions = options) =>
  VltraWatcherLive(watcher).pipe(
    Layer.provideMerge(VltraStoreLive),
    Layer.provideMerge(OpenCodeLive),
    Layer.provideMerge(DirectoriesLive),
    Layer.provideMerge(testConfig(server))
  )

const snapshot = Effect.flatMap(VltraStore, store => store.snapshot)

/** Polls the Vltra snapshot (real time) until `check` holds. */
const eventually = <A>(check: (value: VltraSnapshot) => A | undefined, what: string) =>
  snapshot.pipe(
    Effect.map(check),
    Effect.flatMap(value =>
      value === undefined ? Effect.fail(`waiting for ${what}`) : Effect.succeed(value)
    ),
    Effect.retry(Schedule.spaced('100 millis').pipe(Schedule.upTo({ duration: '20 seconds' }))),
    Effect.orDie
  )

const findRow = (value: VltraSnapshot, id: string): VltraRow | undefined =>
  snapshotRows(value).find(row => row.id === id)

const rowIn = (id: string, state: VltraRow['state']) => (value: VltraSnapshot) => {
  const row = findRow(value, id)

  return row?.state === state ? row : undefined
}

type Created = { readonly data: { readonly id: string } }

const unavailableModel = { providerID: 'vltra-none', id: 'none' }

const createSession = (
  server: OpenCodeServer,
  title: string,
  directory: string = server.workDirectory
) =>
  Effect.map(
    server.json<Created>('POST', '/api/session', {
      title,
      model: unavailableModel,
      permissions: [{ action: 'vltra.test', resource: '*', effect: 'ask' }],
      location: { directory }
    }),
    created => created.data.id
  )

type ParentField = { readonly parentID?: string }

const parentOf = (parentID: string | undefined): ParentField =>
  parentID === undefined ? {} : { parentID }

const importSession = (
  server: OpenCodeServer,
  input: { readonly id: string; readonly parentID?: string; readonly idle: number }
) =>
  server.json('POST', '/api/experimental/session/import', {
    info: {
      id: input.id,
      ...parentOf(input.parentID),
      projectID: 'global',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      outcome: 'succeeded',
      time: { created: input.idle, updated: input.idle, idle: input.idle },
      title: `imported ${input.id}`,
      location: { directory: server.workDirectory }
    },
    messages: []
  })

type StoredSession = {
  readonly data: { readonly metadata?: JsonValue; readonly time: { readonly idle?: number } }
}

/** The session as OpenCode stores it (raw wire JSON, including the whole metadata object). */
const storedSession = (server: OpenCodeServer, sessionID: string) =>
  Effect.map(server.json<StoredSession>('GET', `/api/session/${sessionID}`), body => body.data)

/** Another writer (a plugin, ocb) replacing the whole metadata object. */
const writeMetadata = (server: OpenCodeServer, sessionID: string, metadata: JsonValue) =>
  server.request('PATCH', `/api/session/${sessionID}`, { metadata })

const locationQuery = (server: OpenCodeServer) =>
  `location%5Bdirectory%5D=${encodeURIComponent(server.workDirectory)}`

describe.skipIf(!binary.available)('Vltra against a real opencode serve', () => {
  it.live(
    'tracks sessions, pending requests and handled markers, and resyncs after a restart',
    () =>
      Effect.gen(function* () {
        const server = yield* startOpenCodeServer(binary.available ? binary.path : 'opencode')

        yield* Effect.gen(function* () {
          const connected = yield* eventually(
            value => (value.connection.status === 'connected' ? value.connection : undefined),
            'connection'
          )

          expect(connected.version).toBe(requiredVersion)
          expect(connected.url).toBe(server.url)

          // Actions run in this fiber, outside the layer: they must use the same endpoint.
          const opencode = yield* OpenCode
          const actionConnection = yield* opencode.connect

          expect(actionConnection.url).toBe(server.url)

          // A session that never ran has nothing to handle.
          const sessionID = yield* createSession(server, 'vltra integration')

          yield* eventually(rowIn(sessionID, 'handled'), 'new session')

          // Prompting with an unavailable model: execution starts and fails → finished.
          yield* server.request('POST', `/api/session/${sessionID}/prompt`, { text: 'hello' })

          const failed = yield* eventually(rowIn(sessionID, 'finished'), 'failed run')

          expect(failed.outcome).toBe('failed')
          expect(failed.handled).toBeUndefined()

          // The durable session log (`session.log`) is readable; a failed run has no interrupt.
          expect(yield* actionConnection.interruptReason(sessionID)).toEqual(Option.none())

          // The run's summary (the terminal plugin's page) reads the messages and the diff.
          const summary = yield* loadSessionSummary({ sessionID, idle: failed.idle ?? 1 })

          expect(summary.sessionID).toBe(sessionID)

          // The Stats tab's numbers: the prompt counts, with OpenCode's first message as `from`.
          const stats = yield* actionConnection.stats({
            from: undefined,
            to: Date.now() + 1,
            projectID: undefined,
            timezone: 'Europe/Madrid',
            tools: 'detail'
          })

          expect(stats.sessions).toBeGreaterThanOrEqual(1)
          expect(stats.prompts).toBeGreaterThanOrEqual(1)
          expect(stats.from).toBeLessThanOrEqual(failed.idle ?? Date.now())

          // Mark viewed (panel open) only moves OpenCode's unread marker, never Vltra state.
          expect(yield* markViewed({ sessionID })).toBe('marked')

          const viewed = yield* eventually(value => {
            const row = findRow(value, sessionID)

            return row?.viewed !== undefined && row.viewed >= (row.idle ?? 0) ? row : undefined
          }, 'viewed marker')

          expect(viewed.state).toBe('finished')
          expect(yield* markViewed({ sessionID })).toBe('already-viewed')

          // Another writer's metadata: Vltra must keep it on every write.
          const foreign = { plugin: { pinned: true }, tags: ['a', 'b'] }

          yield* writeMetadata(server, sessionID, { ...foreign, vltra: { note: 'kept' } })

          // Mark handled: metadata.vltra.handled = stored idle → session.metadata.updated → handled.
          expect(yield* markHandled({ sessionID })).toBe('handled')

          const handled = yield* eventually(
            rowIn(sessionID, 'handled'),
            'handled via metadata event'
          )

          const stored = yield* storedSession(server, sessionID)

          expect(handled.handled).toBe(stored.time.idle)
          expect(stored.metadata).toEqual({
            ...foreign,
            vltra: { note: 'kept', handled: stored.time.idle }
          })
          expect(yield* markHandled({ sessionID })).toBe('already-handled')

          // Reopen removes only the marker.
          expect(yield* reopen({ sessionID })).toBe('reopened')
          yield* eventually(rowIn(sessionID, 'finished'), 'reopened')
          expect((yield* storedSession(server, sessionID)).metadata).toEqual({
            ...foreign,
            vltra: { note: 'kept' }
          })
          expect(yield* reopen({ sessionID })).toBe('not-handled')

          yield* markHandled({ sessionID })
          yield* eventually(rowIn(sessionID, 'handled'), 'handled again')

          // Permission: asked → blocked; the chat replies → handled again.
          const asked = yield* server.json<{ readonly data: { readonly id: string } }>(
            'POST',
            `/api/session/${sessionID}/permission?${locationQuery(server)}`,
            { action: 'vltra.test', resources: ['x'] }
          )

          const blocked = yield* eventually(rowIn(sessionID, 'blocked'), 'permission')

          expect(blocked.permissions.map(item => item.id)).toEqual([asked.data.id])

          // Blocked is never handled away.
          const rejected = yield* markHandled({ sessionID }).pipe(Effect.flip)

          expect(rejected._tag).toBe('SessionNotFinishedError')

          const replied = yield* server.request(
            'POST',
            `/api/session/${sessionID}/permission/${asked.data.id}/reply`,
            { decision: 'once' }
          )

          expect(replied.ok).toBe(true)
          yield* eventually(rowIn(sessionID, 'handled'), 'permission replied')

          // Form (V2 agent question): created → blocked; the chat answers → handled.
          const form = yield* server.json<{ readonly data: { readonly id: string } }>(
            'POST',
            `/api/session/${sessionID}/form`,
            { title: 'Pick one', fields: [{ key: 'choice', type: 'string', title: 'Choice?' }] }
          )

          const asking = yield* eventually(rowIn(sessionID, 'blocked'), 'form')

          expect(asking.forms[0]?.fields).toMatchObject([
            { key: 'choice', type: 'string', title: 'Choice?' }
          ])

          const answered = yield* server.request(
            'POST',
            `/api/session/${sessionID}/form/${form.data.id}/reply`,
            { answer: { choice: 'a' } }
          )

          expect(answered.ok).toBe(true)
          yield* eventually(rowIn(sessionID, 'handled'), 'form answered')

          // A finished session with a subagent child: finished, child nested under it.
          const now = Date.now()
          const rootID = 'ses_vltraitroot0000000000001'
          const childID = 'ses_vltraitchild000000000001'

          yield* importSession(server, { id: rootID, idle: now })
          yield* importSession(server, { id: childID, parentID: rootID, idle: now })

          const finished = yield* eventually(value => {
            const row = rowIn(rootID, 'finished')(value)

            return row?.children.some(child => child.id === childID) === true ? row : undefined
          }, 'imported finished session with child')

          expect(finished.children.map(child => [child.id, child.state])).toEqual([
            [childID, 'finished']
          ])

          // Resync: stop OpenCode, change it while Vltra is not listening, start it again.
          yield* server.stop

          yield* eventually(
            value => (value.connection.status === 'disconnected' ? true : undefined),
            'disconnect'
          )

          yield* server.start

          const missedID = 'ses_vltraitmissed00000000001'

          yield* importSession(server, { id: missedID, idle: Date.now() })

          // Another client (the ocb plugin) handles the root while Vltra is away.
          yield* writeMetadata(server, rootID, { vltra: { handled: now } })

          const resynced = yield* eventually(
            value =>
              value.connection.status === 'connected' &&
              findRow(value, missedID)?.state === 'finished' &&
              findRow(value, rootID)?.state === 'handled'
                ? value
                : undefined,
            'resync after restart'
          )

          expect(findRow(resynced, sessionID)?.state).toBe('handled')
          expect(findRow(resynced, rootID)?.handled).toBe(now)
        }).pipe(Effect.provide(vltraLayer(server)))
      }).pipe(Effect.scoped),
    120_000
  )

  it.live(
    'a session whose folder was deleted counts as handled and is never written to',
    () =>
      Effect.gen(function* () {
        const server = yield* startOpenCodeServer(binary.available ? binary.path : 'opencode')

        // Like a `/tmp/tmp.*` scratch folder or a worktree removed after merge.
        const folder = path.join(server.workDirectory, 'tmp.scratch')

        mkdirSync(folder)

        // Quick recounts, so the deletion is noticed without waiting a minute.
        const watcher: WatcherOptions = { ...options, dropDelay: '250 millis', recount: '1 second' }

        yield* Effect.gen(function* () {
          yield* eventually(
            value => (value.connection.status === 'connected' ? true : undefined),
            'connection'
          )

          const sessionID = yield* createSession(server, 'scratch work', folder)

          yield* server.request('POST', `/api/session/${sessionID}/prompt`, { text: 'hello' })

          const finished = yield* eventually(rowIn(sessionID, 'finished'), 'failed run')

          expect(finished.gone).toBe(false)

          rmSync(folder, { recursive: true, force: true })

          const gone = yield* eventually(value => {
            const row = rowIn(sessionID, 'handled')(value)

            return row?.gone === true ? row : undefined
          }, 'deleted folder noticed on a recount')

          expect(gone.handled).toBeUndefined()

          // No marker write: Handled is a no-op, Reopen is refused, metadata stays untouched.
          expect(yield* markHandled({ sessionID })).toBe('already-handled')

          const refused = yield* reopen({ sessionID }).pipe(Effect.flip)

          expect(refused._tag).toBe('SessionFolderGoneError')
          expect((yield* storedSession(server, sessionID)).metadata).toBeUndefined()

          // The run's summary still loads (messages); the diff is skipped.
          const summary = yield* loadSessionSummary({ sessionID, idle: finished.idle ?? 1 })

          expect(summary.sessionID).toBe(sessionID)
          expect(summary.changes).toBeUndefined()

          // Why: once OpenCode has to resolve the location again (here after a restart), every
          // location-scoped write fails on the missing folder (500 on 2.0.20, 404 on 2.0.22).
          yield* server.stop
          yield* server.start

          const write = yield* writeMetadata(server, sessionID, { vltra: { handled: 1 } })

          expect(write.ok).toBe(false)

          yield* eventually(
            value =>
              value.connection.status === 'connected' && findRow(value, sessionID)?.gone === true
                ? true
                : undefined,
            'resync after restart'
          )

          expect(yield* markHandled({ sessionID })).toBe('already-handled')
          expect((yield* storedSession(server, sessionID)).metadata).toBeUndefined()

          // Deleting still works with the folder gone (the projects cleanup relies on it), and
          // deleting it again is a no-op.
          const connection = yield* (yield* OpenCode).connect

          yield* connection.removeSession(sessionID)
          yield* connection.removeSession(sessionID)

          expect((yield* server.request('GET', `/api/session/${sessionID}`)).status).toBe(404)
          yield* eventually(
            value => (findRow(value, sessionID) === undefined ? true : undefined),
            'deleted session leaves the vltra'
          )
        }).pipe(Effect.provide(vltraLayer(server, watcher)))
      }).pipe(Effect.scoped),
    120_000
  )
})
