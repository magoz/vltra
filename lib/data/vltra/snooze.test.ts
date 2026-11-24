import { describe, expect, it } from '@effect/vitest'
import {
  buildAgentsBoard,
  focusList,
  fromSnapshot as liveFromSnapshot,
  snoozedList,
  withOverrides
} from '@/lib/data/vltra/board'
import type { LiveVltra } from '@/lib/data/vltra/board'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, fromSnapshot } from '@/lib/data/vltra/model'
import type { OpenCodeSnapshot, VltraModel } from '@/lib/data/vltra/model'
import { buildRows, buildSnapshot } from '@/lib/data/vltra/snapshot'
import { countRows, isSnoozed } from '@/lib/data/vltra/state'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { VltraRow } from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

// A snooze keeps a finished run out of the needs-me list until a time; the run's own `idle`
// scopes it, so a new run brings the session back, as a new run undoes Done.

const day = 24 * 60 * 60 * 1000

const idle = baseTime + 10

const until = baseTime + 2 * day

const ended = (id: string, fields: Parameters<typeof sessionRecord>[1] = {}) =>
  sessionRecord(id, { idle, outcome: 'succeeded', ...fields })

const modelOf = (snapshot: Partial<OpenCodeSnapshot>): VltraModel =>
  fromSnapshot({ ...emptySnapshot, ...snapshot }, baseTime)

const liveOf = (model: VltraModel): LiveVltra =>
  liveFromSnapshot(
    buildSnapshot(model, {
      connection: { status: 'connected', since: baseTime, failures: 0 },
      webUrl,
      now: baseTime
    })
  )

const rowOf = (model: VltraModel, id: string): VltraRow => {
  const row = buildRows(model, webUrl).find(item => item.id === id)

  if (row === undefined) throw new Error(`no row ${id}`)

  return row
}

const ids = (items: ReadonlyArray<{ readonly row: VltraRow }>) => items.map(item => item.row.id)

const scenario = modelOf({
  sessions: [
    ended('ses_snoozed', { snoozed: { idle, until } }),
    ended('ses_new_run', { snoozed: { idle: idle - 5, until } }),
    ended('ses_plain'),
    ended('ses_asking', { snoozed: { idle, until } })
  ],
  permissions: [{ id: 'per_1', sessionID: 'ses_asking', action: 'bash', resources: [] }]
})

describe('snooze', () => {
  it('holds for the run it was set on, until its time', () => {
    const row = rowOf(scenario, 'ses_snoozed')

    expect(row).toMatchObject({ state: 'finished', snoozedUntil: until })
    expect(isSnoozed(row, baseTime)).toBe(true)
    expect(isSnoozed(row, until - 1)).toBe(true)
    expect(isSnoozed(row, until)).toBe(false)
  })

  it('a new run ends it; a blocked session always shows', () => {
    expect(rowOf(scenario, 'ses_new_run').snoozedUntil).toBeUndefined()
    expect(isSnoozed(rowOf(scenario, 'ses_asking'), baseTime)).toBe(false)
  })

  it('leaves the needs-me list (Focus, the board) for the Snoozed list, and comes back', () => {
    const live = liveOf(scenario)

    expect(ids(focusList(live, baseTime))).toEqual(['ses_asking', 'ses_new_run', 'ses_plain'])
    expect(ids(buildAgentsBoard(live, baseTime, undefined).columns.needsYou)).not.toContain(
      'ses_snoozed'
    )
    expect(ids(snoozedList(live, baseTime))).toEqual(['ses_snoozed'])

    expect(ids(focusList(live, until))).toContain('ses_snoozed')
    expect(snoozedList(live, until)).toEqual([])
  })

  it('lists the soonest back first', () => {
    const live = liveOf(
      modelOf({
        sessions: [
          ended('ses_later', { snoozed: { idle, until: until + day } }),
          ended('ses_sooner', { snoozed: { idle, until } })
        ]
      })
    )

    expect(ids(snoozedList(live, baseTime))).toEqual(['ses_sooner', 'ses_later'])
  })

  it('counts apart from the finished ones that need me', () => {
    expect(countRows(buildRows(scenario, webUrl), baseTime)).toMatchObject({
      blocked: 1,
      finished: 2,
      snoozed: 1
    })
    expect(countRows(buildRows(scenario, webUrl), until)).toMatchObject({
      finished: 3,
      snoozed: 0
    })
  })

  it('follows the metadata event: set, then removed', () => {
    const model = modelOf({ sessions: [ended('ses_1')] })

    const snoozed = applyEvent(
      model,
      VltraEvent.HandledChanged({
        sessionID: 'ses_1',
        handled: undefined,
        snoozed: { idle, until }
      })
    )

    expect(rowOf(snoozed, 'ses_1').snoozedUntil).toBe(until)

    const awake = applyEvent(
      snoozed,
      VltraEvent.HandledChanged({ sessionID: 'ses_1', handled: undefined, snoozed: undefined })
    )

    expect(rowOf(awake, 'ses_1').snoozedUntil).toBeUndefined()
  })

  it('shows at once as an optimistic override: snoozed, then awake', () => {
    const live = liveOf(modelOf({ sessions: [ended('ses_1')] }))
    const base = live.rows.get('ses_1')

    if (base === undefined) throw new Error('no row')

    const snoozed = withOverrides(live, new Map([['ses_1', { base, target: 'snoozed', until }]]))

    expect(ids(focusList(snoozed, baseTime))).toEqual([])
    expect(ids(snoozedList(snoozed, baseTime))).toEqual(['ses_1'])

    const sleeping = snoozed.rows.get('ses_1')

    if (sleeping === undefined) throw new Error('no row')

    const live2 = { ...live, rows: new Map([['ses_1', sleeping]]) }
    const awake = withOverrides(live2, new Map([['ses_1', { base: sleeping, target: 'awake' }]]))

    expect(ids(focusList(awake, baseTime))).toEqual(['ses_1'])
  })
})
