import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import * as FastCheck from 'effect/testing/FastCheck'
import { FleetEvent } from '@/lib/data/fleet/events'
import { applyEvent, applyEvents, emptyModel, fromSnapshot } from '@/lib/data/fleet/model'
import type { FleetModel } from '@/lib/data/fleet/model'
import { ownState } from '@/lib/data/fleet/state'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetState, SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const id = 'ses_1'

const withSession = (info: SessionRecord = sessionRecord(id), running = false) =>
  fromSnapshot({ ...emptySnapshot, sessions: [info], running: running ? [info.id] : [] })

const stateOf = (model: FleetModel, sessionID = id): FleetState => {
  const session = model.sessions.get(sessionID)

  if (session === undefined) throw new Error(`missing ${sessionID}`)

  const pending =
    Array.from(model.permissions.values()).filter(item => item.sessionID === sessionID).length +
    Array.from(model.forms.values()).filter(item => item.sessionID === sessionID).length

  return ownState(session, pending)
}

const started = (at: number) => FleetEvent.ExecutionStarted({ sessionID: id, at })

const ended = (at: number, outcome: 'succeeded' | 'failed' | 'interrupted', shutdown = false) =>
  FleetEvent.ExecutionEnded({ sessionID: id, at, outcome, shutdown })

const permission = FleetEvent.PermissionAsked({
  permission: { id: 'per_1', sessionID: id, action: 'bash', resources: ['rm -rf build'] }
})

const form = FleetEvent.FormCreated({
  form: { id: 'frm_1', sessionID: id, title: 'Which?', fields: [] }
})

describe('state machine transitions (DESIGN.md "Session state")', () => {
  it('idle → working on session.execution.started', () => {
    const model = applyEvent(withSession(), started(baseTime + 1))

    expect(stateOf(model)).toBe('working')
  })

  it('working → done on succeeded, and done → idle when seen', () => {
    const done = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'succeeded')
    ])

    expect(stateOf(done)).toBe('done')
    expect(done.sessions.get(id)?.info.idle).toBe(baseTime + 2)
    expect(done.sessions.get(id)?.info.outcome).toBe('succeeded')

    const seen = applyEvent(done, FleetEvent.Viewed({ sessionID: id, idle: baseTime + 2 }))

    expect(stateOf(seen)).toBe('idle')
  })

  it('working → done on interrupted (by the user)', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'interrupted')
    ])

    expect(stateOf(model)).toBe('done')
  })

  it('a shutdown interruption stops work without a new unseen finish', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'interrupted', true)
    ])

    expect(stateOf(model)).toBe('idle')
    expect(model.sessions.get(id)?.info.idle).toBeUndefined()
  })

  it('working → failed on execution.failed; failed → idle when seen', () => {
    const failed = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'failed')
    ])

    expect(stateOf(failed)).toBe('failed')

    const seen = applyEvent(failed, FleetEvent.Viewed({ sessionID: id, idle: baseTime + 2 }))

    expect(stateOf(seen)).toBe('idle')
  })

  it('failed → working on the next start', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'failed'),
      started(baseTime + 3)
    ])

    expect(stateOf(model)).toBe('working')
  })

  it('session.step.failed marks failed while running; next start or seen clears it', () => {
    const stepFailed = applyEvents(withSession(), [
      started(baseTime + 1),
      FleetEvent.StepFailed({ sessionID: id })
    ])

    expect(stateOf(stepFailed)).toBe('failed')
    expect(stateOf(applyEvent(stepFailed, started(baseTime + 3)))).toBe('working')

    expect(
      stateOf(applyEvent(stepFailed, FleetEvent.Viewed({ sessionID: id, idle: baseTime })))
    ).toBe('working')
  })

  it('a step failure followed by a successful run ends done', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      FleetEvent.StepFailed({ sessionID: id }),
      ended(baseTime + 2, 'succeeded')
    ])

    expect(stateOf(model)).toBe('done')
  })

  it('needs-you on permission.asked, back on permission.replied', () => {
    const working = applyEvent(withSession(), started(baseTime + 1))
    const asked = applyEvent(working, permission)

    expect(stateOf(asked)).toBe('needs-you')
    expect(stateOf(applyEvent(asked, FleetEvent.PermissionReplied({ requestID: 'per_1' })))).toBe(
      'working'
    )
  })

  it('needs-you on form.created, back on form.replied or form.cancelled', () => {
    const asked = applyEvents(withSession(), [started(baseTime + 1), form])

    expect(stateOf(asked)).toBe('needs-you')
    expect(stateOf(applyEvent(asked, FleetEvent.FormSettled({ formID: 'frm_1' })))).toBe('working')
  })

  it('needs-you outranks failed', () => {
    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      ended(baseTime + 2, 'failed'),
      permission
    ])

    expect(stateOf(model)).toBe('needs-you')
  })

  it('session.status busy/retry/idle toggles running', () => {
    const busy = applyEvent(
      withSession(),
      FleetEvent.StatusChanged({ sessionID: id, status: 'busy' })
    )

    expect(stateOf(busy)).toBe('working')

    const idle = applyEvent(busy, FleetEvent.StatusChanged({ sessionID: id, status: 'idle' }))

    expect(stateOf(idle)).toBe('idle')

    expect(
      stateOf(applyEvent(idle, FleetEvent.StatusChanged({ sessionID: id, status: 'retry' })))
    ).toBe('working')
  })

  it('session.retry.scheduled records the retry on a working session', () => {
    const retry = { attempt: 2, at: baseTime + 5, message: 'rate limited' }

    const model = applyEvents(withSession(), [
      started(baseTime + 1),
      FleetEvent.RetryScheduled({ sessionID: id, retry })
    ])

    expect(stateOf(model)).toBe('working')
    expect(model.sessions.get(id)?.retry).toEqual(retry)
    expect(applyEvent(model, ended(baseTime + 6, 'succeeded')).sessions.get(id)?.retry).toBe(
      undefined
    )
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

    expect(model.sessions.get(id)?.info).toMatchObject({
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
  })

  it('upserting keeps live execution facts', () => {
    const working = applyEvent(withSession(), started(baseTime + 1))

    const refreshed = applyEvent(
      working,
      FleetEvent.SessionUpserted({ session: sessionRecord(id, { title: 'Fresh' }) })
    )

    expect(stateOf(refreshed)).toBe('working')
    expect(refreshed.sessions.get(id)?.info.title).toBe('Fresh')
  })
})

describe('resync replay', () => {
  it('replaying a terminal event already in the snapshot does not create a new unseen finish', () => {
    // The snapshot already reflects the run ending at idle and being viewed.
    const snapshot = withSession(
      sessionRecord(id, { idle: baseTime + 2, viewed: baseTime + 2, outcome: 'succeeded' })
    )

    const replayed = applyEvents(snapshot, [
      started(baseTime + 1),
      ended(baseTime + 2, 'succeeded'),
      FleetEvent.Viewed({ sessionID: id, idle: baseTime + 2 })
    ])

    expect(stateOf(replayed)).toBe('idle')
  })

  it('viewed never regresses', () => {
    const model = withSession(sessionRecord(id, { idle: 10, viewed: 10 }))

    expect(
      applyEvent(model, FleetEvent.Viewed({ sessionID: id, idle: 5 })).sessions.get(id)?.info.viewed
    ).toBe(10)
  })

  it('snapshot running ids start as working', () => {
    expect(stateOf(withSession(sessionRecord(id), true))).toBe('working')
    expect(emptyModel.sessions.size).toBe(0)
  })
})

describe('live activity', () => {
  const thinking = FleetEvent.ActivityChanged({
    sessionID: id,
    activity: { kind: 'thinking' },
    callID: undefined
  })

  const tool = FleetEvent.ActivityChanged({
    sessionID: id,
    activity: { kind: 'tool', tool: 'bash' },
    callID: 'call_1'
  })

  const activityOf = (model: FleetModel) => model.sessions.get(id)?.activity

  it('follows steps and tool calls while running', () => {
    const model = applyEvents(withSession(), [started(baseTime + 1), thinking])

    expect(activityOf(model)).toEqual({ kind: 'thinking' })
    expect(activityOf(applyEvent(model, tool))).toEqual({ kind: 'tool', tool: 'bash' })
  })

  it('adds the tool input summary only to the current call', () => {
    const model = applyEvents(withSession(), [started(baseTime + 1), tool])

    const described = applyEvent(
      model,
      FleetEvent.ToolCalled({ sessionID: id, callID: 'call_1', detail: 'pnpm build' })
    )

    expect(activityOf(described)).toEqual({ kind: 'tool', tool: 'bash', detail: 'pnpm build' })

    const stale = applyEvent(
      model,
      FleetEvent.ToolCalled({ sessionID: id, callID: 'call_0', detail: 'ls' })
    )

    expect(activityOf(stale)).toEqual({ kind: 'tool', tool: 'bash' })
  })

  it('clears on end, idle status and the next start', () => {
    const busy = applyEvents(withSession(), [started(baseTime + 1), tool])

    expect(activityOf(applyEvent(busy, ended(baseTime + 2, 'succeeded')))).toBeUndefined()

    expect(
      activityOf(applyEvent(busy, FleetEvent.StatusChanged({ sessionID: id, status: 'idle' })))
    ).toBeUndefined()

    expect(activityOf(applyEvent(busy, started(baseTime + 3)))).toBeUndefined()
  })

  it('does not change the session state', () => {
    const busy = applyEvents(withSession(), [started(baseTime + 1), tool])

    expect(stateOf(busy)).toBe('working')
  })
})

const EventStep = Schema.Literals([
  'start',
  'succeed',
  'fail',
  'interrupt',
  'stepFail',
  'view',
  'ask',
  'reply',
  'form',
  'settle'
])

const eventFor = (step: typeof EventStep.Type, at: number): FleetEvent => {
  switch (step) {
    case 'start':
      return started(at)
    case 'succeed':
      return ended(at, 'succeeded')
    case 'fail':
      return ended(at, 'failed')
    case 'interrupt':
      return ended(at, 'interrupted')
    case 'stepFail':
      return FleetEvent.StepFailed({ sessionID: id })
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
    'pending requests always win, and a replayed sequence is stable',
    [Schema.toArbitrary(Schema.Array(EventStep))(FastCheck)],
    ([steps]) => {
      const events = steps.map((step, index) => eventFor(step, baseTime + 10 + index))
      const model = applyEvents(withSession(), events)
      const pending = model.permissions.size + model.forms.size

      if (pending > 0) expect(stateOf(model)).toBe('needs-you')

      const session = model.sessions.get(id)

      if (pending === 0 && session?.running === true && !session.stepFailed) {
        expect(stateOf(model)).toBe('working')
      }

      // Resync: replaying the same events on the resulting model yields the same state.
      expect(stateOf(applyEvents(model, events))).toBe(stateOf(model))
    }
  )
})
