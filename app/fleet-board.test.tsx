import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FleetBoard } from '@/app/fleet-board'
import { fakeActions, WithActions } from '@/app/testing/dashboard-fixtures'
import { buildBoard, fromSnapshot } from '@/lib/data/fleet/board'
import { fromSnapshot as modelFromSnapshot } from '@/lib/data/fleet/model'
import { buildSnapshot } from '@/lib/data/fleet/snapshot'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const hour = 3_600_000

const now = baseTime + 48 * hour

const handled = (at: number) => ({ idle: at, handled: at, outcome: 'succeeded' as const })

const liveFor = (sessions: ReadonlyArray<SessionRecord>, running: ReadonlyArray<string> = []) =>
  fromSnapshot(
    buildSnapshot(
      modelFromSnapshot(
        {
          ...emptySnapshot,
          sessions,
          running,
          projects: [{ id: 'prj_fleet', name: 'fleet', directory: '/home/magoz/dev/repos/fleet' }]
        },
        now
      ),
      { connection: { status: 'connected', since: 0, failures: 0 }, webUrl, now }
    )
  )

const renderBoard = (
  sessions: ReadonlyArray<SessionRecord>,
  running: ReadonlyArray<string> = []
) => {
  const live = liveFor(sessions, running)

  render(
    <WithActions actions={fakeActions().actions}>
      <FleetBoard
        board={buildBoard(live, now)}
        now={now}
        selection={{ selected: undefined, onSelect: () => undefined }}
      />
    </WithActions>
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('board', () => {
  it('orders needs-me sections before working and collapses handled sessions', () => {
    renderBoard(
      [
        sessionRecord('ses_run', { title: 'Fleet watcher', created: now - hour }),
        sessionRecord('ses_done', {
          title: 'Bump deps',
          idle: now - hour,
          outcome: 'succeeded'
        }),
        sessionRecord('ses_handled', { title: 'Portless route', ...handled(now - 2 * hour) })
      ],
      ['ses_run']
    )

    expect(
      screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)
    ).toEqual(['Needs you · finished1', 'Working1'])

    const group = screen.getByRole('group', { name: 'Handled sessions' })

    expect(group.hasAttribute('open')).toBe(false)
    expect(within(group).getByText('Portless route')).toBeTruthy()
  })

  it('lists handled sessions of any age', () => {
    renderBoard([
      sessionRecord('ses_recent', { title: 'Portless route', ...handled(now - 2 * hour) }),
      sessionRecord('ses_old', { title: 'Typo sweep', ...handled(now - 30 * 24 * hour) })
    ])

    expect(screen.getByText('Typo sweep')).toBeTruthy()
  })

  it('explains an empty fleet', () => {
    renderBoard([])

    expect(screen.getByText(/No OpenCode sessions yet/)).toBeTruthy()
  })
})
