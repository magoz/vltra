import { describe, expect, it } from '@effect/vitest'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { FleetModel, TrackedSession } from '@/lib/data/fleet/model'
import { buildRows } from '@/lib/data/fleet/snapshot'
import {
  activeAt,
  countRows,
  highestPriority,
  isHandled,
  isQuiet,
  isStuck,
  ownState,
  quietAfter,
  rollUpState
} from '@/lib/data/fleet/state'
import { baseTime, sessionRecord, trackedSession, webUrl } from '@/lib/data/fleet/testing/fixtures'
import { fleetStatePriority } from '@/lib/data/fleet/types'
import type { FleetRow, FleetState, Outcome, SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

/** Where Fleet's handled marker stands relative to the latest run (`idle = baseTime + 10`). */
type Marker = 'never-ran' | 'none' | 'older-run' | 'this-run' | 'newer'

const markerFields = (marker: Marker): Partial<SessionRecord> => {
  switch (marker) {
    case 'never-ran':
      return {}
    case 'none':
      return { idle: baseTime + 10 }
    case 'older-run':
      return { idle: baseTime + 10, handled: baseTime + 5 }
    case 'this-run':
      return { idle: baseTime + 10, handled: baseTime + 10 }
    case 'newer':
      return { idle: baseTime + 10, handled: baseTime + 11 }
  }
}

// The DESIGN.md table, written independently of the implementation's branch order.
const expected = (input: {
  readonly pending: number
  readonly running: boolean
  readonly marker: Marker
}): FleetState => {
  const candidates: Array<FleetState> = ['handled']

  if (input.pending > 0) candidates.push('blocked')

  if (input.running) candidates.push('working')

  if (input.marker === 'none' || input.marker === 'older-run') candidates.push('finished')

  return (
    candidates.toSorted(
      (left, right) => fleetStatePriority.indexOf(left) - fleetStatePriority.indexOf(right)
    )[0] ?? 'handled'
  )
}

describe('isHandled', () => {
  it('a session that never ran has nothing to handle', () => {
    expect(isHandled(sessionRecord('ses_1'))).toBe(true)
    expect(isHandled(sessionRecord('ses_1', { handled: 5 }))).toBe(true)
  })

  it('is run-scoped: handled while handled >= idle', () => {
    expect(isHandled(sessionRecord('ses_1', { idle: 10 }))).toBe(false)
    expect(isHandled(sessionRecord('ses_1', { idle: 10, handled: 9 }))).toBe(false)
    expect(isHandled(sessionRecord('ses_1', { idle: 10, handled: 10 }))).toBe(true)
    expect(isHandled(sessionRecord('ses_1', { idle: 10, handled: 11 }))).toBe(true)
  })

  it('ignores OpenCode viewed entirely', () => {
    expect(isHandled(sessionRecord('ses_1', { idle: 10, viewed: 10 }))).toBe(false)
  })
})

describe('ownState', () => {
  const outcomes: ReadonlyArray<Outcome | undefined> = [
    undefined,
    'succeeded',
    'failed',
    'interrupted'
  ]

  const markers: ReadonlyArray<Marker> = ['never-ran', 'none', 'older-run', 'this-run', 'newer']

  const cases = [0, 2].flatMap(pending =>
    [false, true].flatMap(running =>
      outcomes.flatMap(outcome =>
        markers.flatMap(marker =>
          [undefined, baseTime + 10].map(viewed => ({ pending, running, outcome, marker, viewed }))
        )
      )
    )
  )

  it('covers every combination of pending, running, outcome, handled marker and viewed', () => {
    expect(cases).toHaveLength(160)
  })

  it.each(cases)(
    'pending=$pending running=$running $outcome marker=$marker viewed=$viewed',
    input => {
      const info = sessionRecord('ses_1', {
        outcome: input.outcome,
        viewed: input.viewed,
        ...markerFields(input.marker)
      })

      expect(ownState(trackedSession(info, { running: input.running }), input.pending)).toBe(
        expected(input)
      )
    }
  )

  it('names the headline transitions', () => {
    const ended = sessionRecord('ses_1', { idle: 10, outcome: 'succeeded' })

    expect(ownState(trackedSession(ended), 1)).toBe('blocked')
    expect(ownState(trackedSession(ended, { running: true }), 0)).toBe('working')
    expect(ownState(trackedSession(ended), 0)).toBe('finished')
    expect(ownState(trackedSession({ ...ended, outcome: 'failed' }), 0)).toBe('finished')
    expect(ownState(trackedSession({ ...ended, handled: 10 }), 0)).toBe('handled')
    expect(ownState(trackedSession(sessionRecord('ses_1')), 0)).toBe('handled')
  })

  it('a pending request is never handled away', () => {
    expect(ownState(trackedSession(sessionRecord('ses_1', { idle: 10, handled: 10 })), 1)).toBe(
      'blocked'
    )
  })
})

describe('priority and roll-up', () => {
  it('orders blocked > working > finished > handled', () => {
    expect(highestPriority(['handled', 'finished', 'working', 'blocked'])).toBe('blocked')
    expect(highestPriority(['handled', 'finished', 'working'])).toBe('working')
    expect(highestPriority(['handled', 'finished'])).toBe('finished')
    expect(highestPriority([])).toBe('handled')
  })

  const own: ReadonlyArray<FleetState> = fleetStatePriority

  it.each(own)('a %s parent becomes blocked when any descendant is blocked', state => {
    expect(rollUpState(state, ['handled', 'blocked'])).toBe('blocked')
  })

  it.each(own)('a %s parent is at least working when any descendant works', state => {
    expect(rollUpState(state, ['working'])).toBe(highestPriority([state, 'working']))
  })

  it.each(own)('descendant finished/handled runs do not change a %s parent', state => {
    expect(rollUpState(state, ['finished', 'handled'])).toBe(state)
  })
})

describe('activeAt (ordering, never time.updated)', () => {
  const info = sessionRecord('ses_1', { created: baseTime, idle: baseTime + 50 })

  it('is the end of the latest run, else creation, while not running', () => {
    expect(activeAt(trackedSession(info))).toBe(baseTime + 50)
    expect(activeAt(trackedSession(sessionRecord('ses_1')))).toBe(baseTime)
  })

  it('is the latest start or activity while running', () => {
    expect(
      activeAt(
        trackedSession(info, { running: true, startedAt: baseTime + 60, activityAt: baseTime + 90 })
      )
    ).toBe(baseTime + 90)

    expect(activeAt(trackedSession(info, { running: true, startedAt: baseTime + 60 }))).toBe(
      baseTime + 60
    )

    expect(activeAt(trackedSession(info, { running: true }))).toBe(baseTime + 50)
  })
})

describe('stuck (retrying or quiet working rows)', () => {
  const now = baseTime + 60 * 60 * 1000

  const model = (sessions: ReadonlyArray<TrackedSession>): FleetModel => ({
    ...fromSnapshot(emptySnapshot, baseTime),
    sessions: new Map(sessions.map(session => [session.info.id, session] as const))
  })

  const rowOf = (sessions: ReadonlyArray<TrackedSession>, id = 'ses_root'): FleetRow => {
    const row = buildRows(model(sessions), webUrl).find(item => item.id === id)

    if (row === undefined) throw new Error(`no row ${id}`)

    return row
  }

  const root = sessionRecord('ses_root')
  const child = sessionRecord('ses_child', { parentID: 'ses_root' })

  it('a working row active within the threshold is not stuck', () => {
    const row = rowOf([trackedSession(root, { running: true, activityAt: now - quietAfter + 1 })])

    expect(isQuiet(row, now)).toBe(false)
    expect(isStuck(row, now)).toBe(false)
  })

  it('a working row quiet for the threshold is stuck', () => {
    const row = rowOf([trackedSession(root, { running: true, activityAt: now - quietAfter })])

    expect(isQuiet(row, now)).toBe(true)
    expect(isStuck(row, now)).toBe(true)
  })

  it('a waiting parent is not quiet while a running subagent is active', () => {
    const row = rowOf([
      trackedSession(root, { running: true, activityAt: now - 2 * quietAfter }),
      trackedSession(child, { running: true, activityAt: now - 1000 })
    ])

    expect(isStuck(row, now)).toBe(false)
  })

  it('a scheduled retry anywhere in the running subtree is stuck', () => {
    const retry = { attempt: 3, at: now + 1000, message: 'rate limited' }

    const row = rowOf([
      trackedSession(root, { running: true, activityAt: now }),
      trackedSession(child, { running: true, activityAt: now, retry })
    ])

    expect(isStuck(row, now)).toBe(true)
  })

  it('blocked, finished and handled rows are never stuck', () => {
    const finished = rowOf([trackedSession(sessionRecord('ses_root', { idle: baseTime }))])

    expect(finished.state).toBe('finished')
    expect(isStuck(finished, now)).toBe(false)
  })

  it('counts root rows by state; stuck overlaps working', () => {
    const rows = [
      rowOf([trackedSession(root, { running: true, activityAt: now - quietAfter })]),
      rowOf([trackedSession(sessionRecord('ses_a'), { running: true, activityAt: now })], 'ses_a'),
      rowOf([trackedSession(sessionRecord('ses_b', { idle: baseTime }))], 'ses_b'),
      rowOf([trackedSession(sessionRecord('ses_c'))], 'ses_c')
    ]

    expect(countRows(rows, now)).toEqual({
      blocked: 0,
      finished: 1,
      working: 2,
      stuck: 1,
      handled: 1
    })
  })
})
