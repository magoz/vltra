import { describe, expect, it } from '@effect/vitest'
import { highestPriority, isUnseen, ownState, rollUpState } from '@/lib/data/fleet/state'
import { baseTime, sessionRecord, trackedSession } from '@/lib/data/fleet/testing/fixtures'
import { fleetStatePriority } from '@/lib/data/fleet/types'
import type { FleetState, Outcome, SessionRecord } from '@/lib/data/fleet/types'

type Seen = 'never-finished' | 'unseen' | 'seen'

const seenFields = (seen: Seen): Partial<SessionRecord> => {
  if (seen === 'never-finished') return {}

  if (seen === 'unseen') return { idle: baseTime + 10, viewed: baseTime + 5 }

  return { idle: baseTime + 10, viewed: baseTime + 10 }
}

// The DESIGN.md table, written independently of the implementation's branch order.
const expected = (input: {
  readonly pending: number
  readonly running: boolean
  readonly stepFailed: boolean
  readonly outcome: Outcome | undefined
  readonly seen: Seen
}): FleetState => {
  const candidates: Array<FleetState> = ['idle']

  if (input.pending > 0) candidates.push('needs-you')

  if (input.stepFailed) candidates.push('failed')

  if (!input.running && input.seen === 'unseen' && input.outcome === 'failed') {
    candidates.push('failed')
  }

  if (input.running) candidates.push('working')

  if (!input.running && input.seen === 'unseen' && input.outcome !== 'failed') {
    candidates.push('done')
  }

  return (
    candidates.toSorted(
      (left, right) => fleetStatePriority.indexOf(left) - fleetStatePriority.indexOf(right)
    )[0] ?? 'idle'
  )
}

describe('isUnseen', () => {
  it('is false until a run has finished', () => {
    expect(isUnseen(sessionRecord('ses_1'))).toBe(false)
  })

  it('follows OpenCode viewed < idle', () => {
    expect(isUnseen(sessionRecord('ses_1', { idle: 10 }))).toBe(true)
    expect(isUnseen(sessionRecord('ses_1', { idle: 10, viewed: 9 }))).toBe(true)
    expect(isUnseen(sessionRecord('ses_1', { idle: 10, viewed: 10 }))).toBe(false)
    expect(isUnseen(sessionRecord('ses_1', { idle: 10, viewed: 11 }))).toBe(false)
  })
})

describe('ownState', () => {
  const outcomes: ReadonlyArray<Outcome | undefined> = [
    undefined,
    'succeeded',
    'failed',
    'interrupted'
  ]

  const cases = [0, 2].flatMap(pending =>
    [false, true].flatMap(running =>
      [false, true].flatMap(stepFailed =>
        outcomes.flatMap(outcome =>
          (['never-finished', 'unseen', 'seen'] as const).map(seen => ({
            pending,
            running,
            stepFailed,
            outcome,
            seen
          }))
        )
      )
    )
  )

  it('covers every combination of pending, running, step failure, outcome and seen', () => {
    expect(cases).toHaveLength(96)
  })

  it.each(cases)(
    'pending=$pending running=$running stepFailed=$stepFailed $outcome $seen',
    input => {
      const info = sessionRecord('ses_1', { outcome: input.outcome, ...seenFields(input.seen) })

      const session = trackedSession(info, {
        running: input.running,
        stepFailed: input.stepFailed
      })

      expect(ownState(session, input.pending)).toBe(expected(input))
    }
  )

  it('names the headline transitions', () => {
    const finished = sessionRecord('ses_1', { idle: 10, outcome: 'succeeded' })
    const failed = sessionRecord('ses_1', { idle: 10, outcome: 'failed' })

    expect(ownState(trackedSession(finished), 1)).toBe('needs-you')
    expect(ownState(trackedSession(failed), 0)).toBe('failed')
    expect(ownState(trackedSession(failed, { running: true }), 0)).toBe('working')
    expect(ownState(trackedSession(finished), 0)).toBe('done')
    expect(ownState(trackedSession({ ...finished, viewed: 10 }), 0)).toBe('idle')

    expect(ownState(trackedSession(finished, { running: true, stepFailed: true }), 0)).toBe(
      'failed'
    )
  })
})

describe('priority and roll-up', () => {
  it('orders needs-you > failed > working > done > idle', () => {
    expect(highestPriority(['idle', 'done', 'working', 'failed', 'needs-you'])).toBe('needs-you')
    expect(highestPriority(['idle', 'done', 'working', 'failed'])).toBe('failed')
    expect(highestPriority(['idle', 'done', 'working'])).toBe('working')
    expect(highestPriority(['idle', 'done'])).toBe('done')
    expect(highestPriority([])).toBe('idle')
  })

  const own: ReadonlyArray<FleetState> = fleetStatePriority

  it.each(own)('a %s parent becomes needs-you when any descendant needs you', state => {
    expect(rollUpState(state, ['idle', 'needs-you'])).toBe('needs-you')
  })

  it.each(own)('a %s parent is at least working when any descendant works', state => {
    expect(rollUpState(state, ['working'])).toBe(highestPriority([state, 'working']))
  })

  it.each(own)('descendant failed/done/idle do not change a %s parent', state => {
    expect(rollUpState(state, ['failed', 'done', 'idle'])).toBe(state)
  })
})
