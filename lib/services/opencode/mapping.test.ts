import { describe, expect, it } from '@effect/vitest'
import { OpenCodeEvent } from '@opencode/protocol/groups/event'
import { Session } from '@opencode/client/effect'
import { Effect, Schema } from 'effect'
import { FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import { toSessionRecord, toSignals } from '@/lib/services/opencode/mapping'
import type { JsonValue } from '@/lib/services/opencode/testing/opencode-server'

// Wire JSON as served by a real `opencode serve` v2.0.20 (captured, ids shortened), decoded with
// OpenCode's own event schema so the mapping is tested against the real decoded shapes.

const decodeEvent = Schema.decodeUnknownEffect(OpenCodeEvent)

const sessionID = 'ses_f0b9ab9d6ffe3b6lVV32tvtooh'

const durable = (seq: number) => ({ aggregateID: sessionID, seq, version: 1 })

const location = { directory: '/tmp/fleet/work' }

const wire = {
  connected: { id: 'evt_1', type: 'server.connected', data: {} },
  created: {
    id: 'evt_2',
    created: 1790806672952,
    type: 'session.created',
    location,
    durable: durable(0),
    data: {
      sessionID,
      slug: 'stellar-comet',
      version: '2.0.20',
      projectID: 'global',
      location,
      title: 'spike'
    }
  },
  started: {
    id: 'evt_3',
    created: 1790806673000,
    type: 'session.execution.started',
    durable: durable(2),
    data: { sessionID }
  },
  failed: {
    id: 'evt_4',
    created: 1790806673204,
    type: 'session.execution.failed',
    durable: durable(5),
    data: {
      sessionID,
      error: { type: 'provider.no-route', message: 'Model unavailable: fleet-none/none' }
    }
  },
  interrupted: {
    id: 'evt_5',
    created: 1790806673300,
    type: 'session.execution.interrupted',
    durable: durable(6),
    data: { sessionID, reason: 'shutdown' }
  },
  viewed: {
    id: 'evt_6',
    created: 1790806673400,
    type: 'session.viewed',
    durable: durable(7),
    data: { sessionID, idle: 1790806673204 }
  },
  asked: {
    id: 'evt_7',
    created: 1790806673500,
    type: 'permission.asked',
    location,
    data: { id: 'per_0f465b7e3', sessionID, action: 'fleet.test', resources: ['x'] }
  },
  replied: {
    id: 'evt_8',
    created: 1790806673600,
    type: 'permission.replied',
    data: { sessionID, requestID: 'per_0f465b7e3', reply: 'once' }
  },
  formCreated: {
    id: 'evt_9',
    created: 1790806673700,
    type: 'form.created',
    location,
    data: {
      form: {
        id: 'frm_0f4658aba',
        sessionID,
        title: 'Pick',
        fields: [{ key: 'a', title: 'A?', type: 'string' }]
      }
    }
  },
  formCancelled: {
    id: 'evt_10',
    created: 1790806673800,
    type: 'form.cancelled',
    data: { id: 'frm_0f4658aba', sessionID }
  },
  resolvedSameProject: {
    id: 'evt_11',
    created: 1790806574771,
    type: 'worktree.resolved',
    durable: { aggregateID: 'global', seq: 0, version: 1 },
    data: { projectID: 'global', directory: '/tmp/fleet/work', previous: 'global' }
  },
  resolvedAdopting: {
    id: 'evt_12',
    created: 1790806574771,
    type: 'worktree.resolved',
    durable: { aggregateID: 'prj_new', seq: 0, version: 1 },
    data: { projectID: 'prj_new', directory: '/tmp/fleet/work', previous: 'global' }
  },
  textDelta: {
    id: 'evt_13',
    created: 1790806577088,
    type: 'session.reasoning.delta',
    location,
    data: { sessionID, assistantMessageID: 'msg_0f463c80e', ordinal: 0, delta: '\n' }
  }
}

const signalsFor = (json: JsonValue) => Effect.map(decodeEvent(json), toSignals)

describe('OpenCode event mapping', () => {
  it.effect('server.connected marks the subscription as live', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.connected)).toEqual([OpenCodeSignal.Connected()])
    })
  )

  it.effect('session.created asks for the stored session row', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.created)).toEqual([
        OpenCodeSignal.RefreshSession({ sessionID })
      ])
    })
  )

  it.effect('execution events carry the event time and outcome', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.started)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ExecutionStarted({ sessionID, at: 1790806673000 })
        })
      ])

      expect(yield* signalsFor(wire.failed)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ExecutionEnded({
            sessionID,
            at: 1790806673204,
            outcome: 'failed',
            shutdown: false
          })
        })
      ])

      expect(yield* signalsFor(wire.interrupted)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ExecutionEnded({
            sessionID,
            at: 1790806673300,
            outcome: 'interrupted',
            shutdown: true
          })
        })
      ])
    })
  )

  it.effect('session.viewed carries the viewer idle watermark', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.viewed)).toEqual([
        OpenCodeSignal.Apply({ event: FleetEvent.Viewed({ sessionID, idle: 1790806673204 }) })
      ])
    })
  )

  it.effect('permissions and forms (V2 agent questions) map to pending requests', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.asked)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.PermissionAsked({
            permission: {
              id: 'per_0f465b7e3',
              sessionID,
              action: 'fleet.test',
              resources: ['x'],
              message: undefined
            }
          })
        })
      ])

      expect(yield* signalsFor(wire.replied)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.PermissionReplied({ requestID: 'per_0f465b7e3' })
        })
      ])

      expect(yield* signalsFor(wire.formCreated)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.FormCreated({ form: { id: 'frm_0f4658aba', sessionID, title: 'Pick' } })
        })
      ])

      expect(yield* signalsFor(wire.formCancelled)).toEqual([
        OpenCodeSignal.Apply({ event: FleetEvent.FormSettled({ formID: 'frm_0f4658aba' }) })
      ])
    })
  )

  it.effect('worktree resolution resyncs only when it can adopt sessions', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.resolvedSameProject)).toEqual([
        OpenCodeSignal.RefreshWorktrees({ projectID: 'global' })
      ])

      expect(yield* signalsFor(wire.resolvedAdopting)).toEqual([OpenCodeSignal.Resync()])
    })
  )

  it.effect('ignores events Fleet does not track', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.textDelta)).toEqual([])
    })
  )
})

describe('session row mapping', () => {
  it.effect('reads outcome, idle and viewed as epoch milliseconds', () =>
    Effect.gen(function* () {
      const info = yield* Schema.decodeUnknownEffect(Session.Info)({
        id: sessionID,
        projectID: 'global',
        model: { id: 'none', providerID: 'fleet-none', variant: 'default' },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        outcome: 'failed',
        time: { created: 1790806672952, updated: 1790806673183, idle: 1790806673204 },
        title: 'spike3',
        location
      })

      expect(toSessionRecord(info)).toEqual({
        id: sessionID,
        parentID: undefined,
        projectID: 'global',
        directory: '/tmp/fleet/work',
        title: 'spike3',
        agent: undefined,
        model: 'fleet-none/none',
        cost: 0,
        created: 1790806672952,
        updated: 1790806673183,
        idle: 1790806673204,
        viewed: undefined,
        archived: undefined,
        outcome: 'failed'
      })
    })
  )
})
