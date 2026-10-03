import { describe, expect, it } from '@effect/vitest'
import { InvalidRequestError, ProjectNotFoundError } from '@opencode/protocol/errors'
import { OpenCodeEvent } from '@opencode/protocol/groups/event'
import { WorktreeError } from '@opencode/protocol/groups/worktree'
import { Session, SessionMessage } from '@opencode/client/effect'
import { Effect, Option, Schema } from 'effect'
import { FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import {
  fleetHandled,
  latestRunEnd,
  refusalMessage,
  sanitizeMessage,
  toFormField,
  toolDetail,
  toSessionRecord,
  toSignals,
  toTranscript,
  withFleetHandled
} from '@/lib/services/opencode/mapping'
import type { RunEnd } from '@/lib/services/opencode/mapping'
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
  interruptedByUser: {
    id: 'evt_19',
    created: 1790806673310,
    type: 'session.execution.interrupted',
    durable: durable(12),
    data: { sessionID, reason: 'user' }
  },
  interruptedByInactivity: {
    id: 'evt_20',
    created: 1790806673320,
    type: 'session.execution.interrupted',
    durable: durable(13),
    data: { sessionID, reason: 'inactivity' }
  },
  metadataUpdated: {
    id: 'evt_21',
    created: 1790806673330,
    type: 'session.metadata.updated',
    durable: durable(14),
    data: { sessionID, metadata: { plugin: { x: 1 }, fleet: { handled: 1790806673204 } } }
  },
  metadataCleared: {
    id: 'evt_22',
    created: 1790806673340,
    type: 'session.metadata.updated',
    durable: durable(15),
    data: { sessionID, metadata: { plugin: { x: 1 } } }
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
  formHidden: {
    id: 'evt_18',
    created: 1790806673700,
    type: 'form.created',
    location,
    data: {
      form: {
        id: 'frm_0f4658abb',
        sessionID,
        title: 'Token',
        fields: [
          { key: 'region', type: 'string', hidden: true, default: 'eu' },
          { key: 'ok', type: 'boolean' }
        ]
      }
    }
  },
  stepStarted: {
    id: 'evt_14',
    created: 1790806577000,
    type: 'session.step.started',
    durable: durable(8),
    data: {
      sessionID,
      assistantMessageID: 'msg_0f463c80e',
      agent: 'build',
      model: { id: 'none', providerID: 'fleet-none' },
      started: 1790806577000
    }
  },
  textStarted: {
    id: 'evt_15',
    created: 1790806577010,
    type: 'session.text.started',
    durable: durable(9),
    data: { sessionID, assistantMessageID: 'msg_0f463c80e', ordinal: 0 }
  },
  toolInputStarted: {
    id: 'evt_16',
    created: 1790806577020,
    type: 'session.tool.input.started',
    durable: durable(10),
    data: { sessionID, assistantMessageID: 'msg_0f463c80e', id: 'call_1', name: 'bash' }
  },
  toolCalled: {
    id: 'evt_17',
    created: 1790806577030,
    type: 'session.tool.called',
    durable: durable(11),
    data: {
      sessionID,
      assistantMessageID: 'msg_0f463c80e',
      id: 'call_1',
      input: { command: 'pnpm build\nexit', timeout: 120 },
      executed: true
    }
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
            reason: undefined
          })
        })
      ])

      expect(yield* signalsFor(wire.interrupted)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ExecutionEnded({
            sessionID,
            at: 1790806673300,
            outcome: 'interrupted',
            reason: 'shutdown'
          })
        })
      ])
    })
  )

  it.effect('interruptions carry their reason', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.interruptedByUser)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ExecutionEnded({
            sessionID,
            at: 1790806673310,
            outcome: 'interrupted',
            reason: 'user'
          })
        })
      ])

      expect(yield* signalsFor(wire.interruptedByInactivity)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ExecutionEnded({
            sessionID,
            at: 1790806673320,
            outcome: 'interrupted',
            reason: 'inactivity'
          })
        })
      ])
    })
  )

  it.effect('session.metadata.updated carries the (whole, replaced) handled marker', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.metadataUpdated)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.HandledChanged({ sessionID, handled: 1790806673204 })
        })
      ])

      expect(yield* signalsFor(wire.metadataCleared)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.HandledChanged({ sessionID, handled: undefined })
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
          event: FleetEvent.FormCreated({
            form: {
              id: 'frm_0f4658aba',
              sessionID,
              title: 'Pick',
              fields: [
                {
                  key: 'a',
                  title: 'A?',
                  type: 'string',
                  description: undefined,
                  required: undefined,
                  when: undefined,
                  placeholder: undefined,
                  default: undefined,
                  options: undefined,
                  custom: undefined
                }
              ]
            }
          })
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

  it.effect('steps, text and tool calls map to live activity', () =>
    Effect.gen(function* () {
      expect(yield* signalsFor(wire.stepStarted)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ActivityChanged({
            sessionID,
            activity: { kind: 'thinking' },
            callID: undefined,
            at: 1790806577000
          })
        })
      ])

      expect(yield* signalsFor(wire.textStarted)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ActivityChanged({
            sessionID,
            activity: { kind: 'writing' },
            callID: undefined,
            at: 1790806577010
          })
        })
      ])

      expect(yield* signalsFor(wire.toolInputStarted)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ActivityChanged({
            sessionID,
            activity: { kind: 'tool', tool: 'bash' },
            callID: 'call_1',
            at: 1790806577020
          })
        })
      ])

      expect(yield* signalsFor(wire.toolCalled)).toEqual([
        OpenCodeSignal.Apply({
          event: FleetEvent.ToolCalled({
            sessionID,
            callID: 'call_1',
            detail: 'pnpm build',
            at: 1790806577030
          })
        })
      ])
    })
  )

  it('summarises tool input by its most telling field', () => {
    expect(toolDetail({ filePath: '/repo/src/a.ts', offset: 1 })).toBe('/repo/src/a.ts')
    expect(toolDetail({ pattern: '**/*.ts' })).toBe('**/*.ts')
    expect(toolDetail({ command: 'x'.repeat(200) })).toHaveLength(120)
    expect(toolDetail({ todos: [] })).toBeUndefined()
  })

  it('maps form fields and skips hidden ones', () => {
    expect(
      toFormField({
        key: 'format',
        type: 'string',
        title: 'Which format?',
        options: [
          { value: 'pdf', label: 'PDF' },
          { value: 'docx', label: 'DOCX' }
        ]
      })
    ).toMatchObject({
      key: 'format',
      type: 'string',
      options: [{ value: 'pdf' }, { value: 'docx' }]
    })

    expect(
      toFormField({ key: 'tags', type: 'multiselect', options: [{ value: 'a', label: 'A' }] })
    ).toMatchObject({ type: 'multiselect', options: [{ value: 'a', label: 'A' }] })
  })

  it.effect('skips hidden form fields (OpenCode uses their default)', () =>
    Effect.gen(function* () {
      const [signal] = yield* signalsFor(wire.formHidden)

      expect(signal).toMatchObject({
        event: { form: { fields: [{ key: 'ok', type: 'boolean' }] } }
      })
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
        idle: 1790806673204,
        viewed: undefined,
        archived: undefined,
        outcome: 'failed',
        handled: undefined
      })
    })
  )

  it.effect("reads Fleet's handled marker from metadata.fleet.handled", () =>
    Effect.gen(function* () {
      const info = yield* Schema.decodeUnknownEffect(Session.Info)({
        id: sessionID,
        projectID: 'global',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1790806672952, updated: 1790806673183, idle: 1790806673204 },
        metadata: { other: true, fleet: { handled: 1790806673204 } },
        location
      })

      expect(toSessionRecord(info).handled).toBe(1790806673204)
    })
  )
})

describe('handled marker in session metadata', () => {
  it('reads metadata.fleet.handled; absent or malformed reads as unhandled', () => {
    expect(fleetHandled({ fleet: { handled: 42 } })).toBe(42)
    expect(fleetHandled({ fleet: { handled: 42, note: 'x' }, other: [1] })).toBe(42)
    expect(fleetHandled(undefined)).toBeUndefined()
    expect(fleetHandled({})).toBeUndefined()
    expect(fleetHandled({ fleet: null })).toBeUndefined()
    expect(fleetHandled({ fleet: 'handled' })).toBeUndefined()
    expect(fleetHandled({ fleet: { handled: '42' } })).toBeUndefined()
    expect(fleetHandled({ fleet: [42] })).toBeUndefined()
  })

  it('sets only fleet.handled and keeps every other key', () => {
    expect(withFleetHandled(undefined, 42)).toEqual({ fleet: { handled: 42 } })

    expect(
      withFleetHandled({ plugin: { a: 1 }, tags: ['x'], fleet: { handled: 1, note: 'n' } }, 42)
    ).toEqual({ plugin: { a: 1 }, tags: ['x'], fleet: { handled: 42, note: 'n' } })
  })

  it('replaces a malformed fleet value', () => {
    expect(withFleetHandled({ fleet: 'oops', other: 1 }, 42)).toEqual({
      other: 1,
      fleet: { handled: 42 }
    })

    expect(withFleetHandled({ fleet: [1, 2] }, 42)).toEqual({ fleet: { handled: 42 } })
  })

  it('clearing deletes the key, and fleet once it is empty', () => {
    expect(withFleetHandled({ fleet: { handled: 1, note: 'n' }, other: 1 }, undefined)).toEqual({
      fleet: { note: 'n' },
      other: 1
    })

    expect(withFleetHandled({ fleet: { handled: 1 }, other: 1 }, undefined)).toEqual({ other: 1 })
    expect(withFleetHandled(undefined, undefined)).toEqual({})
  })
})

describe('session log → latest run end', () => {
  const logItem = (json: JsonValue) => Effect.map(decodeEvent(json), event => event)

  const fold = (items: ReadonlyArray<JsonValue>) =>
    Effect.map(Effect.forEach(items, logItem), events =>
      events.reduce<RunEnd | undefined>(latestRunEnd, undefined)
    )

  it.effect('names the last terminal event, skipping shutdown interruptions', () =>
    Effect.gen(function* () {
      expect(yield* fold([wire.started, wire.failed])).toEqual({
        outcome: 'failed',
        reason: undefined
      })

      expect(yield* fold([wire.failed, wire.interruptedByUser, wire.interrupted])).toEqual({
        outcome: 'interrupted',
        reason: 'user'
      })

      expect(yield* fold([wire.interruptedByInactivity, wire.viewed])).toEqual({
        outcome: 'interrupted',
        reason: 'inactivity'
      })

      expect(yield* fold([wire.created, wire.interrupted])).toBeUndefined()
    })
  )
})

describe('transcript mapping', () => {
  const model = { id: 'none', providerID: 'fleet-none' }

  // Newest first, as `GET /api/session/:id/message?order=desc` returns them.
  const messages = [
    { id: 'msg_4', type: 'idle', outcome: 'failed', time: { created: 1790806600400 } },
    {
      id: 'msg_3',
      type: 'assistant',
      agent: 'build',
      model,
      time: { created: 1790806600300 },
      content: [
        { type: 'reasoning', text: 'Let me check.' },
        { type: 'text', text: '  Updated README and 3 guides.  ' },
        {
          type: 'tool',
          id: 'call_1',
          name: 'bash',
          state: { status: 'running', input: { command: 'pnpm build' }, metadata: {} },
          time: { created: 1790806600310 }
        }
      ],
      error: { type: 'provider.no-route', message: 'Model unavailable' }
    },
    {
      id: 'msg_2',
      type: 'shell',
      shellID: 'sh_1',
      command: 'ls',
      status: 'exited',
      time: { created: 1790806600200 }
    },
    {
      id: 'msg_1',
      type: 'user',
      text: 'Rewrite the README',
      time: { created: 1790806600100 }
    }
  ]

  it.effect('orders oldest first, keeps text, tools and failures, drops reasoning', () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(SessionMessage.Info))(messages)
      const transcript = toTranscript(decoded, 60)

      expect(transcript.entries.map(entry => [entry.role, entry.text, entry.status])).toEqual([
        ['user', 'Rewrite the README', undefined],
        ['shell', '$ ls', 'completed'],
        ['agent', 'Updated README and 3 guides.', undefined],
        ['tool', 'bash · pnpm build', 'running'],
        ['error', 'Model unavailable', undefined],
        ['note', 'Run failed', undefined]
      ])

      expect(transcript.answer).toBe('Updated README and 3 guides.')
      expect(toTranscript(decoded, 2).entries.map(entry => entry.role)).toEqual(['error', 'note'])
    })
  )
})

describe('refusalMessage', () => {
  it("passes OpenCode's own refusal messages through, sanitized", () => {
    const worktree = new WorktreeError({
      name: 'WorktreeError',
      data: { message: 'worktree-manage: \u001b[31mrefusing\u001b[0m dirty checkout\n  /x' }
    })

    expect(refusalMessage(worktree)).toEqual(
      Option.some('worktree-manage: refusing dirty checkout /x')
    )
    expect(refusalMessage(new InvalidRequestError({ message: 'Bad directory' }))).toEqual(
      Option.some('Bad directory')
    )
    expect(
      refusalMessage(new ProjectNotFoundError({ projectID: 'nope', message: 'Project not found' }))
    ).toEqual(Option.some('Project not found'))
  })

  it('leaves transport failures and anything else to the generic error', () => {
    expect(refusalMessage(new Error('fetch failed'))).toEqual(Option.none())
    expect(refusalMessage({ name: 'WorktreeError', data: { message: '   ' } })).toEqual(
      Option.none()
    )
    expect(refusalMessage('boom')).toEqual(Option.none())
  })

  it('clips long messages to one line', () => {
    const message = sanitizeMessage(`a\tb\r\n${'x'.repeat(1000)}`)

    expect(message.startsWith('a b x')).toBe(true)
    expect(message.length).toBe(400)
  })
})
