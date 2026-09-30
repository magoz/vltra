import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Schedule } from 'effect'
import { markSeen, replyForm, replyPermission } from '@/lib/data/fleet/actions'
import { snapshotRows } from '@/lib/data/fleet/snapshot'
import { FleetStore, FleetStoreLive } from '@/lib/data/fleet/store'
import type { FleetRow, FleetSnapshot } from '@/lib/data/fleet/types'
import { FleetWatcherLive } from '@/lib/data/fleet/watcher'
import type { WatcherOptions } from '@/lib/data/fleet/watcher'
import { OpenCode } from '@/lib/services/opencode/service'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'
import { findOpenCode, startOpenCodeServer } from '@/lib/services/opencode/testing/opencode-server'
import type { OpenCodeServer } from '@/lib/services/opencode/testing/opencode-server'

// Runs Fleet against a real, isolated, throwaway `opencode serve` (v2.0.20). No model is ever
// called: sessions use an unavailable model so prompts fail fast, and outbound HTTP is blocked.

const binary = findOpenCode()

// Belt and braces: even if some code path ignored the test's config, discovery must never find
// the live service's registration file from this process.
process.env.OPENCODE_SERVICE_FILE = '/nonexistent/fleet-integration/service.json'

if (!binary.available) {
  console.warn(`Skipping OpenCode integration tests: ${binary.reason}`)
}

// A long pause after a drop leaves time to change OpenCode while Fleet is not listening.
const options: WatcherOptions = {
  reconnect: Schedule.min([Schedule.exponential('100 millis'), Schedule.spaced('1 second')]),
  dropDelay: '6 seconds',
  connectTimeout: '10 seconds'
}

const testConfig = (server: OpenCodeServer) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: { OPENCODE_URL: server.url, OPENCODE_PASSWORD: server.password }
    })
  )

const fleetLayer = (server: OpenCodeServer) =>
  FleetWatcherLive(options).pipe(
    Layer.provideMerge(FleetStoreLive),
    Layer.provideMerge(OpenCodeLive),
    Layer.provideMerge(testConfig(server))
  )

const snapshot = Effect.flatMap(FleetStore, store => store.snapshot)

/** Polls the Fleet snapshot (real time) until `check` holds. */
const eventually = <A>(check: (value: FleetSnapshot) => A | undefined, what: string) =>
  snapshot.pipe(
    Effect.map(check),
    Effect.flatMap(value =>
      value === undefined ? Effect.fail(`waiting for ${what}`) : Effect.succeed(value)
    ),
    Effect.retry(Schedule.spaced('100 millis').pipe(Schedule.upTo({ duration: '20 seconds' }))),
    Effect.orDie
  )

const findRow = (value: FleetSnapshot, id: string): FleetRow | undefined =>
  snapshotRows(value).find(row => row.id === id)

const rowIn = (id: string, state: FleetRow['state']) => (value: FleetSnapshot) => {
  const row = findRow(value, id)

  return row?.state === state ? row : undefined
}

type Created = { readonly data: { readonly id: string } }

const unavailableModel = { providerID: 'fleet-none', id: 'none' }

const createSession = (server: OpenCodeServer, title: string) =>
  Effect.map(
    server.json<Created>('POST', '/api/session', {
      title,
      model: unavailableModel,
      permissions: [{ action: 'fleet.test', resource: '*', effect: 'ask' }],
      location: { directory: server.workDirectory }
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

const locationQuery = (server: OpenCodeServer) =>
  `location%5Bdirectory%5D=${encodeURIComponent(server.workDirectory)}`

describe.skipIf(!binary.available)('Fleet against a real opencode serve', () => {
  it.live(
    'tracks sessions, pending requests and seen state, and resyncs after a restart',
    () =>
      Effect.gen(function* () {
        const server = yield* startOpenCodeServer(binary.available ? binary.path : 'opencode')

        yield* Effect.gen(function* () {
          const connected = yield* eventually(
            value => (value.connection.status === 'connected' ? value.connection : undefined),
            'connection'
          )

          expect(connected.version).toBe('2.0.20')
          expect(connected.url).toBe(server.url)

          // Actions run in this fiber, outside the layer: they must use the same endpoint.
          const opencode = yield* OpenCode
          const actionConnection = yield* opencode.connect

          expect(actionConnection.url).toBe(server.url)

          // A new session appears as idle.
          const sessionID = yield* createSession(server, 'fleet integration')

          yield* eventually(rowIn(sessionID, 'idle'), 'new idle session')

          // Prompting with an unavailable model: execution starts and fails → failed (unseen).
          yield* server.request('POST', `/api/session/${sessionID}/prompt`, { text: 'hello' })

          const failed = yield* eventually(rowIn(sessionID, 'failed'), 'failed run')

          expect(failed.outcome).toBe('failed')
          expect(failed.unseen).toBe(true)

          // Mark seen through Fleet → OpenCode `session.viewed` → idle.
          expect(yield* markSeen({ sessionID })).toBe('marked')
          yield* eventually(rowIn(sessionID, 'idle'), 'seen failed run')
          expect(yield* markSeen({ sessionID })).toBe('already-seen')

          // Permission: asked → needs-you; Fleet replies → idle again.
          const asked = yield* server.json<{ readonly data: { readonly id: string } }>(
            'POST',
            `/api/session/${sessionID}/permission?${locationQuery(server)}`,
            { action: 'fleet.test', resources: ['x'] }
          )

          const needsYou = yield* eventually(rowIn(sessionID, 'needs-you'), 'permission')

          expect(needsYou.permissions.map(item => item.id)).toEqual([asked.data.id])

          yield* replyPermission({ sessionID, requestID: asked.data.id, decision: 'once' })
          yield* eventually(rowIn(sessionID, 'idle'), 'permission replied')

          // Form (V2 agent question): created → needs-you; Fleet answers → idle.
          const form = yield* server.json<{ readonly data: { readonly id: string } }>(
            'POST',
            `/api/session/${sessionID}/form`,
            { title: 'Pick one', fields: [{ key: 'choice', type: 'string', title: 'Choice?' }] }
          )

          yield* eventually(rowIn(sessionID, 'needs-you'), 'form')
          yield* replyForm({ sessionID, formID: form.data.id, answer: { choice: 'a' } })
          yield* eventually(rowIn(sessionID, 'idle'), 'form answered')

          // A finished, unseen session with a subagent child: done, child nested under it.
          const now = Date.now()
          const rootID = 'ses_fleetitroot0000000000001'
          const childID = 'ses_fleetitchild000000000001'

          yield* importSession(server, { id: rootID, idle: now })
          yield* importSession(server, { id: childID, parentID: rootID, idle: now })

          const done = yield* eventually(value => {
            const row = rowIn(rootID, 'done')(value)

            return row?.children.some(child => child.id === childID) === true ? row : undefined
          }, 'imported done session with child')

          expect(done.children.map(child => child.id)).toEqual([childID])

          // Resync: stop OpenCode, change it while Fleet is not listening, start it again.
          yield* server.stop

          yield* eventually(
            value => (value.connection.status === 'disconnected' ? true : undefined),
            'disconnect'
          )

          yield* server.start

          const missedID = 'ses_fleetitmissed00000000001'

          yield* importSession(server, { id: missedID, idle: Date.now() })

          yield* server.request('POST', `/api/session/${rootID}/view`, { idle: now })

          const resynced = yield* eventually(
            value =>
              value.connection.status === 'connected' &&
              findRow(value, missedID)?.state === 'done' &&
              findRow(value, rootID)?.state === 'idle'
                ? value
                : undefined,
            'resync after restart'
          )

          expect(findRow(resynced, sessionID)?.state).toBe('idle')
        }).pipe(Effect.provide(fleetLayer(server)))
      }).pipe(Effect.scoped),
    120_000
  )
})
