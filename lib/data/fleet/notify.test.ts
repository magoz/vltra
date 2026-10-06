import { describe, expect, it } from '@effect/vitest'
import { FleetEvent } from '@/lib/data/fleet/events'
import { applyEvent, emptyModel, fromSnapshot } from '@/lib/data/fleet/model'
import type { FleetModel } from '@/lib/data/fleet/model'
import {
  Attention,
  attentionBetween,
  distinctSessions,
  pushMessage,
  sessionUrl,
  stillNeeded
} from '@/lib/data/fleet/notify'
import type { Notice } from '@/lib/data/fleet/notify'
import { buildSnapshot } from '@/lib/data/fleet/snapshot'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetConnection, FleetSnapshot, SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connection: FleetConnection = { status: 'connected', since: baseTime, failures: 0 }

const scratch = '/home/magoz/scratch'

const modelOf = (sessions: ReadonlyArray<SessionRecord>, running: ReadonlyArray<string> = []) =>
  fromSnapshot(
    {
      ...emptySnapshot,
      sessions,
      running,
      projects: [
        { id: 'prj_fleet', name: 'fleet', directory: '/home/magoz/dev/repos/fleet' },
        { id: 'global', directory: '/' }
      ]
    },
    baseTime
  )

const snapshotOf = (model: FleetModel): FleetSnapshot =>
  buildSnapshot(model, { connection, webUrl, now: baseTime + 60_000 })

const apply = (model: FleetModel, ...events: ReadonlyArray<FleetEvent>) =>
  events.reduce(applyEvent, model)

const ended = (sessionID: string, at: number, outcome: 'succeeded' | 'failed' = 'succeeded') =>
  FleetEvent.ExecutionEnded({ sessionID, at, outcome, reason: undefined })

const permission = (sessionID: string) =>
  FleetEvent.PermissionAsked({
    permission: { id: `per_${sessionID}`, sessionID, action: 'bash', resources: ['rm -rf'] }
  })

const working = modelOf(
  [sessionRecord('ses_a'), sessionRecord('ses_sub', { parentID: 'ses_a' })],
  ['ses_a']
)

describe('attention between snapshots', () => {
  it('starts from nothing: rows new to Fleet (the first snapshot after a start) never notify', () => {
    const blocked = apply(working, permission('ses_a'))

    expect(attentionBetween(snapshotOf(emptyModel), snapshotOf(blocked))).toEqual([])
  })

  it('a session that becomes blocked, by its own ask or a subagent’s', () => {
    expect(
      attentionBetween(snapshotOf(working), snapshotOf(apply(working, permission('ses_sub'))))
    ).toEqual([Attention.Blocked({ sessionID: 'ses_a' })])
  })

  it('a run that ends unhandled, once per run', () => {
    const done = apply(working, ended('ses_a', baseTime + 5_000))

    expect(attentionBetween(snapshotOf(working), snapshotOf(done))).toEqual([
      Attention.Finished({ sessionID: 'ses_a', idle: baseTime + 5_000 })
    ])
    // Still finished, same run: no news.
    expect(attentionBetween(snapshotOf(done), snapshotOf(done))).toEqual([])
  })

  it('reopening a handled run is no news (its idle did not change)', () => {
    const done = apply(working, ended('ses_a', baseTime + 5_000))

    const handled = apply(
      done,
      FleetEvent.HandledChanged({ sessionID: 'ses_a', handled: baseTime + 5_000 })
    )

    const reopened = apply(
      handled,
      FleetEvent.HandledChanged({ sessionID: 'ses_a', handled: undefined })
    )

    expect(attentionBetween(snapshotOf(handled), snapshotOf(reopened))).toEqual([])
  })

  it('a session that stays blocked is not news again', () => {
    const blocked = apply(working, permission('ses_a'))

    expect(attentionBetween(snapshotOf(blocked), snapshotOf(blocked))).toEqual([])
  })
})

describe('still needed after the grace period', () => {
  const finishedAt = baseTime + 5_000
  const done = apply(working, ended('ses_a', finishedAt))
  const attention = Attention.Finished({ sessionID: 'ses_a', idle: finishedAt })

  it('the same run, still finished, not handled, not opened', () => {
    expect(stillNeeded(attention, snapshotOf(done))).toMatchObject({
      attention,
      project: 'fleet',
      row: { id: 'ses_a' }
    })
  })

  it('not once opened, handled, or run again', () => {
    const viewed = apply(done, FleetEvent.Viewed({ sessionID: 'ses_a', idle: finishedAt }))

    const handled = apply(
      done,
      FleetEvent.HandledChanged({ sessionID: 'ses_a', handled: finishedAt })
    )

    const again = apply(
      done,
      FleetEvent.ExecutionStarted({ sessionID: 'ses_a', at: finishedAt + 1 })
    )

    expect(stillNeeded(attention, snapshotOf(viewed))).toBeUndefined()
    expect(stillNeeded(attention, snapshotOf(handled))).toBeUndefined()
    expect(stillNeeded(attention, snapshotOf(again))).toBeUndefined()
    expect(stillNeeded(attention, snapshotOf(emptyModel))).toBeUndefined()
  })

  it('blocked: only while still blocked', () => {
    const blocked = apply(working, permission('ses_a'))
    const answered = apply(blocked, FleetEvent.PermissionReplied({ requestID: 'per_ses_a' }))
    const asked = Attention.Blocked({ sessionID: 'ses_a' })

    expect(stillNeeded(asked, snapshotOf(blocked))?.row.id).toBe('ses_a')
    expect(stillNeeded(asked, snapshotOf(answered))).toBeUndefined()
  })
})

describe('push message', () => {
  const finishedAt = baseTime + 5_000

  const notice = (model: FleetModel, attention: Attention): Notice => {
    const found = stillNeeded(attention, snapshotOf(model))

    if (found === undefined) throw new Error('expected a notice')

    return found
  }

  const blocked = notice(
    apply(working, permission('ses_a')),
    Attention.Blocked({ sessionID: 'ses_a' })
  )

  it("one session: OpenCode's title, project and session, tagged and opening it", () => {
    expect(pushMessage([blocked])).toEqual({
      title: 'Permission required',
      body: 'fleet · Session ses_a',
      tag: 'ses_a',
      url: '/?session=ses_a'
    })
    expect(sessionUrl('ses_a')).toBe('/?session=ses_a')
  })

  it('names a failed run and a session outside any repository by its folder', () => {
    const other = modelOf(
      [sessionRecord('ses_o', { projectID: 'global', directory: scratch })],
      ['ses_o']
    )

    const failed = notice(
      apply(other, ended('ses_o', finishedAt, 'failed')),
      Attention.Finished({ sessionID: 'ses_o', idle: finishedAt })
    )

    expect(pushMessage([failed])).toMatchObject({
      title: 'Session error',
      body: 'scratch · Session ses_o'
    })
  })

  it('several: one summary that opens Focus', () => {
    const done = notice(
      apply(working, ended('ses_a', finishedAt)),
      Attention.Finished({ sessionID: 'ses_a', idle: finishedAt })
    )

    const other = { ...blocked, row: { ...blocked.row, id: 'ses_b', title: 'Other' } }

    expect(pushMessage([done, other])).toEqual({
      title: '2 sessions need you',
      body: 'Response ready: fleet · Session ses_a\nPermission required: fleet · Other',
      tag: 'fleet-summary',
      url: '/'
    })
    expect(pushMessage([])).toBeUndefined()
  })

  it('one notice per session, the latest', () => {
    const done = notice(
      apply(working, ended('ses_a', finishedAt)),
      Attention.Finished({ sessionID: 'ses_a', idle: finishedAt })
    )

    expect(distinctSessions([blocked, done])).toEqual([done])
  })
})
