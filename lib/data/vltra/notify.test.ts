import { describe, expect, it } from '@effect/vitest'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, emptyModel, fromSnapshot } from '@/lib/data/vltra/model'
import type { VltraModel } from '@/lib/data/vltra/model'
import {
  Attention,
  attentionBetween,
  distinctSessions,
  pushMessage,
  sessionUrl,
  stillNeeded
} from '@/lib/data/vltra/notify'
import type { Notice } from '@/lib/data/vltra/notify'
import { buildSnapshot } from '@/lib/data/vltra/snapshot'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { VltraConnection, VltraSnapshot, SessionRecord } from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connection: VltraConnection = { status: 'connected', since: baseTime, failures: 0 }

const scratch = '/home/me/scratch'

const modelOf = (sessions: ReadonlyArray<SessionRecord>, running: ReadonlyArray<string> = []) =>
  fromSnapshot(
    {
      ...emptySnapshot,
      sessions,
      running,
      projects: [
        { id: 'prj_vltra', name: 'vltra', directory: '/home/me/dev/repos/vltra' },
        { id: 'global', directory: '/' }
      ]
    },
    baseTime
  )

const snapshotOf = (model: VltraModel): VltraSnapshot =>
  buildSnapshot(model, { connection, webUrl, now: baseTime + 60_000 })

const apply = (model: VltraModel, ...events: ReadonlyArray<VltraEvent>) =>
  events.reduce(applyEvent, model)

const ended = (sessionID: string, at: number, outcome: 'succeeded' | 'failed' = 'succeeded') =>
  VltraEvent.ExecutionEnded({ sessionID, at, outcome, reason: undefined })

const permission = (sessionID: string) =>
  VltraEvent.PermissionAsked({
    permission: { id: `per_${sessionID}`, sessionID, action: 'bash', resources: ['rm -rf'] }
  })

const working = modelOf(
  [sessionRecord('ses_a'), sessionRecord('ses_sub', { parentID: 'ses_a' })],
  ['ses_a']
)

describe('attention between snapshots', () => {
  it('starts from nothing: rows new to Vltra (the first snapshot after a start) never notify', () => {
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
      VltraEvent.HandledChanged({ sessionID: 'ses_a', handled: baseTime + 5_000 })
    )

    const reopened = apply(
      handled,
      VltraEvent.HandledChanged({ sessionID: 'ses_a', handled: undefined })
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
      project: 'vltra',
      row: { id: 'ses_a' }
    })
  })

  it('not once opened, handled, or run again', () => {
    const viewed = apply(done, VltraEvent.Viewed({ sessionID: 'ses_a', idle: finishedAt }))

    const handled = apply(
      done,
      VltraEvent.HandledChanged({ sessionID: 'ses_a', handled: finishedAt })
    )

    const again = apply(
      done,
      VltraEvent.ExecutionStarted({ sessionID: 'ses_a', at: finishedAt + 1 })
    )

    expect(stillNeeded(attention, snapshotOf(viewed))).toBeUndefined()
    expect(stillNeeded(attention, snapshotOf(handled))).toBeUndefined()
    expect(stillNeeded(attention, snapshotOf(again))).toBeUndefined()
    expect(stillNeeded(attention, snapshotOf(emptyModel))).toBeUndefined()
  })

  it('blocked: only while still blocked', () => {
    const blocked = apply(working, permission('ses_a'))
    const answered = apply(blocked, VltraEvent.PermissionReplied({ requestID: 'per_ses_a' }))
    const asked = Attention.Blocked({ sessionID: 'ses_a' })

    expect(stillNeeded(asked, snapshotOf(blocked))?.row.id).toBe('ses_a')
    expect(stillNeeded(asked, snapshotOf(answered))).toBeUndefined()
  })
})

describe('push message', () => {
  const finishedAt = baseTime + 5_000

  const notice = (model: VltraModel, attention: Attention): Notice => {
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
      body: 'vltra · Session ses_a',
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
      body: 'Response ready: vltra · Session ses_a\nPermission required: vltra · Other',
      tag: 'vltra-summary',
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
