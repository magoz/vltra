import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import * as FastCheck from 'effect/testing/FastCheck'
import { FleetEvent } from '@/lib/data/fleet/events'
import { applyEvent, applyEvents, emptyModel, fromSnapshot } from '@/lib/data/fleet/model'
import type { FleetModel, TrackedSession } from '@/lib/data/fleet/model'
import { ownState } from '@/lib/data/fleet/state'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetState, InterruptReason, Outcome, SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const id = 'ses_1'

const connectedAt = baseTime + 1_000_000

const withSession = (info: SessionRecord = sessionRecord(id), running = false) =>
  fromSnapshot(
    { ...emptySnapshot, sessions: [info], running: running ? [info.id] : [] },
    connectedAt
  )

const sessionOf = (model: FleetModel, sessionID = id): TrackedSession => {
  const session = model.sessions.get(sessionID)

  if (session === undefined) throw new Error(`missing ${sessionID}`)

  return session
}

const stateOf = (model: FleetModel, sessionID = id): FleetState => {
  const pending =
    Array.from(model.permissions.values()).filter(item => item.sessionID === sessionID).length +
    Array.from(model.forms.values()).filter(item => item.sessionID === sessionID).length

  return ownState(sessionOf(model, sessionID), pending)
}

const started = (at: number) => FleetEvent.ExecutionStarted({ sessionID: id, at })

const ended = (at: number, outcome: Outcome, reason?: InterruptReason) =>
  FleetEvent.ExecutionEnded({ sessionID: id, at, outcome, reason })

const handled = (value: number | undefined) =>
  FleetEvent.HandledChanged({ sessionID: id, handled: value })

const permission = FleetEvent.PermissionAsked({
  permission: { id: 'per_1', sessionID: id, action: 'bash', resources: ['rm -rf build'] }
})

const form = FleetEvent.FormCreated({
  form: { id: 'frm_1', sessionID: id, title: 'Which?', fields: [] }
})

describe('state machine transitions (DESIGN.md "Session state")', () => {
  it('a session that never ran is handled; it works once a run starts', () => {
    expect(stateOf(withSession())).toBe('handled')
    expect(stateOf(applyEvent(withSession(), started(baseTime + 1)))).toBe('working')
  })

  it.each(['succeeded', 'failed'] as const)('working → finished when the run %s', outcome => {
    const model = applyEvents(withSession(), [started(baseTime + 1), ended(baseTime + 2, outcome)])

    expect(stateOf(model)).toBe('finished')
    expect(sessionOf(model).info).toMatchObject({ idle: baseTime + 2, outcome })
    expect(sessionOf(model).interrupt).toBeUndefined()
  })

  it.each(['user', 'inactivity', 'superseded'] as const)(
    'an interruption by %s finishes the run and keeps its reason',
    reason => {
      const model = applyEvents(withSession(), [
        started(baseTime + 1),
        ended(baseTime + 2, 'interrupted', reason)
      ])

      expect(stateOf(model)).toBe('finished')
      expect(sessionOf(model).info).toMatchObject({ idle: baseTime + 2, outcome: 'interrupted' })
      expect(sessionOf(model).interrupt).toBe(reason)
    }
  )

  it('a shutdown interruption only stops work: no new run end, no reason', () => {
    const before = withSession(sessionRecord(id, { idle: baseTime, outcome: 'succeeded' }))

    const model = applyEvents(before, [
      handled(baseTime),
      started(baseTime + 1),
      ended(baseTime + 2, 'interrupted', 'shutdown')
    ])

    expect(stateOf(model)).toBe('handled')
    expect(sessionOf(model).info).toMatchObject({ idle: baseTime, outcome: 'succeeded' })
    expect(sessionOf(model).interrupt).toBeUndefined()
  })

  it('finished → handled on the handled marker for that run, and back on reopen', () => {
    const finished = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'failed')
    ])

    const done = applyEvent(finished, handled(baseTime + 2))

    expect(stateOf(done)).toBe('handled')
    expect(sessionOf(done).info.handled).toBe(baseTime + 2)
    expect(stateOf(applyEvent(done, handled(undefined)))).toBe('finished')
  })

  it('handled is per run: the next run ending finishes the session again', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'succeeded'),
      handled(baseTime + 2),
      started(baseTime + 3)
    ])

    expect(stateOf(model)).toBe('working')

    const next = applyEvent(model, ended(baseTime + 4, 'succeeded'))

    expect(stateOf(next)).toBe('finished')
    expect(sessionOf(next).info.handled).toBe(baseTime + 2)
  })

  it('a marker for an older run does not handle the latest one', () => {
    expect(
      stateOf(withSession(sessionRecord(id, { idle: baseTime + 5, handled: baseTime + 4 })))
    ).toBe('finished')
  })

  it('OpenCode viewed never changes the state', () => {
    const finished = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'succeeded')
    ])

    const viewed = applyEvent(finished, FleetEvent.Viewed({ sessionID: id, idle: baseTime + 2 }))

    expect(stateOf(viewed)).toBe('finished')
    expect(sessionOf(viewed).info.viewed).toBe(baseTime + 2)
  })

  it('blocked on permission.asked, back on permission.replied', () => {
    const working = applyEvent(withSession(), started(baseTime + 1))
    const asked = applyEvent(working, permission)

    expect(stateOf(asked)).toBe('blocked')
    expect(stateOf(applyEvent(asked, FleetEvent.PermissionReplied({ requestID: 'per_1' })))).toBe(
      'working'
    )
  })

  it('blocked on form.created, back on form.replied or form.cancelled', () => {
    const asked = applyEvents(withSession(), [started(baseTime + 1), form])

    expect(stateOf(asked)).toBe('blocked')
    expect(stateOf(applyEvent(asked, FleetEvent.FormSettled({ formID: 'frm_1' })))).toBe('working')
  })

  it('a handled marker never clears blocked', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'succeeded'),
      permission,
      handled(baseTime + 2)
    ])

    expect(stateOf(model)).toBe('blocked')
  })

  it('session.status busy/retry/idle toggles running', () => {
    const busy = applyEvent(
      withSession(),
      FleetEvent.StatusChanged({ sessionID: id, status: 'busy', at: baseTime + 1 })
    )

    expect(stateOf(busy)).toBe('working')
    expect(sessionOf(busy).activityAt).toBe(baseTime + 1)

    const idle = applyEvent(
      busy,
      FleetEvent.StatusChanged({ sessionID: id, status: 'idle', at: baseTime + 2 })
    )

    expect(stateOf(idle)).toBe('handled')

    expect(
      stateOf(
        applyEvent(
          idle,
          FleetEvent.StatusChanged({ sessionID: id, status: 'retry', at: baseTime + 3 })
        )
      )
    ).toBe('working')
  })

  it('session.retry.scheduled records the retry; the next step or the end clears it', () => {
    const retry = { attempt: 2, at: baseTime + 5, message: 'rate limited' }

    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      FleetEvent.RetryScheduled({ sessionID: id, retry, at: baseTime + 2 })
    ])

    expect(stateOf(model)).toBe('working')
    expect(sessionOf(model).retry).toEqual(retry)
    expect(sessionOf(applyEvent(model, ended(baseTime + 6, 'succeeded'))).retry).toBeUndefined()

    const stepped = applyEvent(
      model,
      FleetEvent.ActivityChanged({
        sessionID: id,
        activity: { kind: 'thinking' },
        callID: undefined,
        at: baseTime + 6
      })
    )

    expect(sessionOf(stepped).retry).toBeUndefined()
  })

  it('session.deleted removes the session and its pending requests', () => {
    const model = applyEvents(withSession(), [
      permission,
      form,
      FleetEvent.SessionRemoved({ sessionID: id })
    ])

    expect(model.sessions.has(id)).toBe(false)
    expect(model.permissions.size).toBe(0)
    expect(model.forms.size).toBe(0)
  })

  it('renames, agent/model selection and usage patch the row', () => {
    const model = applyEvents(withSession(), [
      FleetEvent.SessionRenamed({ sessionID: id, title: 'Renamed' }),
      FleetEvent.AgentSelected({ sessionID: id, agent: 'plan' }),
      FleetEvent.ModelSelected({ sessionID: id, model: 'anthropic/claude' }),
      FleetEvent.UsageUpdated({ sessionID: id, cost: 1.25 })
    ])

    expect(sessionOf(model).info).toMatchObject({
      title: 'Renamed',
      agent: 'plan',
      model: 'anthropic/claude',
      cost: 1.25
    })
  })

  it('events for unknown sessions leave the model unchanged', () => {
    const model = withSession()

    expect(applyEvent(model, FleetEvent.ExecutionStarted({ sessionID: 'ses_x', at: 1 }))).toBe(
      model
    )

    expect(applyEvent(model, FleetEvent.HandledChanged({ sessionID: 'ses_x', handled: 1 }))).toBe(
      model
    )
  })

  it('upserting keeps live execution facts', () => {
    const working = applyEvent(withSession(), started(baseTime + 1))

    const refreshed = applyEvent(
      working,
      FleetEvent.SessionUpserted({ session: sessionRecord(id, { title: 'Fresh' }) })
    )

    expect(stateOf(refreshed)).toBe('working')
    expect(sessionOf(refreshed).info.title).toBe('Fresh')
    expect(sessionOf(refreshed).startedAt).toBe(baseTime + 1)
  })
})

describe('interrupt reasons', () => {
  const interrupted = sessionRecord(id, { idle: baseTime + 2, outcome: 'interrupted' })

  it('a recovered reason applies only to the run it was read for', () => {
    const model = withSession(interrupted)

    const recovered = applyEvent(
      model,
      FleetEvent.InterruptRecovered({ sessionID: id, idle: baseTime + 2, reason: 'inactivity' })
    )

    expect(sessionOf(recovered).interrupt).toBe('inactivity')

    const stale = applyEvent(
      model,
      FleetEvent.InterruptRecovered({ sessionID: id, idle: baseTime + 1, reason: 'user' })
    )

    expect(sessionOf(stale).interrupt).toBeUndefined()
  })

  it('a recovered reason is ignored when the run did not end interrupted', () => {
    const model = withSession(sessionRecord(id, { idle: baseTime + 2, outcome: 'succeeded' }))

    const recovered = applyEvent(
      model,
      FleetEvent.InterruptRecovered({ sessionID: id, idle: baseTime + 2, reason: 'user' })
    )

    expect(sessionOf(recovered).interrupt).toBeUndefined()
  })

  it('the next run end replaces the reason', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'interrupted', 'inactivity'),
      started(baseTime + 3),
      ended(baseTime + 4, 'succeeded')
    ])

    expect(sessionOf(model).interrupt).toBeUndefined()
  })

  it('a re-read keeps the reason for the same run and drops it for another', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'interrupted', 'user')
    ])

    const same = applyEvent(model, FleetEvent.SessionUpserted({ session: interrupted }))

    expect(sessionOf(same).interrupt).toBe('user')

    const other = applyEvent(
      model,
      FleetEvent.SessionUpserted({
        session: sessionRecord(id, { idle: baseTime + 9, outcome: 'interrupted' })
      })
    )

    expect(sessionOf(other).interrupt).toBeUndefined()
  })
})

describe('resync replay', () => {
  it('replaying a terminal event already in the snapshot keeps the stored run and its marker', () => {
    // The snapshot already reflects the run ending at idle and being handled.
    const snapshot = withSession(
      sessionRecord(id, { idle: baseTime + 2, handled: baseTime + 2, outcome: 'succeeded' })
    )

    const replayed = applyEvents(snapshot, [
      started(baseTime + 1),
      ended(baseTime + 2, 'succeeded'),
      handled(baseTime + 2)
    ])

    expect(stateOf(replayed)).toBe('handled')
    expect(sessionOf(replayed).info.idle).toBe(baseTime + 2)
  })

  it('a replayed interruption names the reason of the stored run', () => {
    // OpenCode stamped idle one millisecond after the event (`max(created, previousIdle + 1)`).
    const snapshot = withSession(sessionRecord(id, { idle: baseTime + 3, outcome: 'interrupted' }))

    const replayed = applyEvent(snapshot, ended(baseTime + 2, 'interrupted', 'user'))

    expect(sessionOf(replayed).info.idle).toBe(baseTime + 3)
    expect(sessionOf(replayed).interrupt).toBe('user')
  })

  it('viewed never regresses', () => {
    const model = withSession(sessionRecord(id, { idle: 10, viewed: 10 }))

    expect(
      sessionOf(applyEvent(model, FleetEvent.Viewed({ sessionID: id, idle: 5 }))).info.viewed
    ).toBe(10)
  })

  it('snapshot running ids start as working, active since the connection', () => {
    const model = withSession(sessionRecord(id), true)

    expect(stateOf(model)).toBe('working')
    expect(sessionOf(model).activityAt).toBe(connectedAt)
    expect(sessionOf(model).startedAt).toBeUndefined()
    expect(sessionOf(withSession()).activityAt).toBeUndefined()
    expect(emptyModel.sessions.size).toBe(0)
  })
})

describe('live activity', () => {
  const thinking = (at: number) =>
    FleetEvent.ActivityChanged({
      sessionID: id,
      activity: { kind: 'thinking' },
      callID: undefined,
      at
    })

  const tool = (at: number) =>
    FleetEvent.ActivityChanged({
      sessionID: id,
      activity: { kind: 'tool', tool: 'bash' },
      callID: 'call_1',
      at
    })

  const activityOf = (model: FleetModel) => sessionOf(model).activity

  it('follows steps and tool calls while running', () => {
    const model = applyEvents(withSession(), [started(baseTime + 1), thinking(baseTime + 2)])

    expect(activityOf(model)).toEqual({ kind: 'thinking' })
    expect(activityOf(applyEvent(model, tool(baseTime + 3)))).toEqual({
      kind: 'tool',
      tool: 'bash'
    })
  })

  it('adds the tool input summary only to the current call', () => {
    const model = applyEvents(withSession(), [started(baseTime + 1), tool(baseTime + 2)])

    const described = applyEvent(
      model,
      FleetEvent.ToolCalled({ sessionID: id, callID: 'call_1', detail: 'pnpm build', at: 3 })
    )

    expect(activityOf(described)).toEqual({ kind: 'tool', tool: 'bash', detail: 'pnpm build' })

    const stale = applyEvent(
      model,
      FleetEvent.ToolCalled({ sessionID: id, callID: 'call_0', detail: 'ls', at: 3 })
    )

    expect(activityOf(stale)).toEqual({ kind: 'tool', tool: 'bash' })
  })

  it('tracks the run start and the last activity time, never going back', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      thinking(baseTime + 5),
      tool(baseTime + 4),
      FleetEvent.ToolCalled({ sessionID: id, callID: 'call_1', detail: 'ls', at: baseTime + 9 })
    ])

    expect(sessionOf(model).startedAt).toBe(baseTime + 1)
    expect(sessionOf(model).activityAt).toBe(baseTime + 9)
  })

  it('clears on end, idle status and the next start', () => {
    const busy = applyEvents(withSession(), [started(baseTime + 1), tool(baseTime + 2)])
    const stopped = applyEvent(busy, ended(baseTime + 3, 'succeeded'))

    expect(activityOf(stopped)).toBeUndefined()
    expect(sessionOf(stopped).activityAt).toBeUndefined()
    expect(sessionOf(stopped).startedAt).toBeUndefined()

    expect(
      activityOf(
        applyEvent(
          busy,
          FleetEvent.StatusChanged({ sessionID: id, status: 'idle', at: baseTime + 3 })
        )
      )
    ).toBeUndefined()

    const restarted = applyEvent(busy, started(baseTime + 4))

    expect(activityOf(restarted)).toBeUndefined()
    expect(sessionOf(restarted).activityAt).toBe(baseTime + 4)
  })

  it('does not change the session state', () => {
    const busy = applyEvents(withSession(), [started(baseTime + 1), tool(baseTime + 2)])

    expect(stateOf(busy)).toBe('working')
  })
})

const EventStep = Schema.Literals([
  'start',
  'succeed',
  'fail',
  'interruptUser',
  'interruptInactivity',
  'shutdown',
  'handle',
  'reopen',
  'view',
  'ask',
  'reply',
  'form',
  'settle'
])

const eventFor = (step: typeof EventStep.Type, at: number, model: FleetModel): FleetEvent => {
  switch (step) {
    case 'start':
      return started(at)
    case 'succeed':
      return ended(at, 'succeeded')
    case 'fail':
      return ended(at, 'failed')
    case 'interruptUser':
      return ended(at, 'interrupted', 'user')
    case 'interruptInactivity':
      return ended(at, 'interrupted', 'inactivity')
    case 'shutdown':
      return ended(at, 'interrupted', 'shutdown')
    case 'handle':
      return handled(model.sessions.get(id)?.info.idle)
    case 'reopen':
      return handled(undefined)
    case 'view':
      return FleetEvent.Viewed({ sessionID: id, idle: at - 1 })
    case 'ask':
      return permission
    case 'reply':
      return FleetEvent.PermissionReplied({ requestID: 'per_1' })
    case 'form':
      return form
    case 'settle':
      return FleetEvent.FormSettled({ formID: 'frm_1' })
  }
}

describe('state machine invariants', () => {
  it.prop(
    'blocked wins, handled is run-scoped, and a replayed sequence is stable',
    [Schema.toArbitrary(Schema.Array(EventStep))(FastCheck)],
    ([steps]) => {
      const events: Array<FleetEvent> = []

      const model = steps.reduce((current, step, index) => {
        const event = eventFor(step, baseTime + 10 + index, current)

        events.push(event)

        return applyEvent(current, event)
      }, withSession())

      const session = sessionOf(model)
      const pending = model.permissions.size + model.forms.size
      const state = stateOf(model)

      if (pending > 0) expect(state).toBe('blocked')

      if (pending === 0 && session.running) expect(state).toBe('working')

      if (pending === 0 && !session.running) {
        const { idle, handled: marker } = session.info

        expect(state).toBe(
          idle !== undefined && (marker === undefined || marker < idle) ? 'finished' : 'handled'
        )
      }

      // The reason always belongs to an interrupted latest run.
      if (session.interrupt !== undefined) expect(session.info.outcome).toBe('interrupted')

      // Resync: replaying the same events on the resulting model yields the same state.
      expect(stateOf(applyEvents(model, events))).toBe(state)
    }
  )
})
