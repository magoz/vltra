import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
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

const seen = (at: number) => ({ idle: at, updated: at, viewed: at, outcome: 'succeeded' as const })

const liveFor = (sessions: ReadonlyArray<SessionRecord>, running: ReadonlyArray<string> = []) =>
  fromSnapshot(
    buildSnapshot(
      modelFromSnapshot({
        ...emptySnapshot,
        sessions,
        running,
        projects: [{ id: 'prj_fleet', name: 'fleet', directory: '/home/magoz/dev/repos/fleet' }]
      }),
      { connection: { status: 'connected', since: 0, failures: 0 }, webUrl, now }
    )
  )

const renderBoard = (
  sessions: ReadonlyArray<SessionRecord>,
  running: ReadonlyArray<string> = []
) => {
  const live = liveFor(sessions, running)

  const Harness = () => {
    const [showOlder, setShowOlder] = useState(false)

    return (
      <FleetBoard
        board={buildBoard(live, now, showOlder)}
        now={now}
        showOlder={showOlder}
        onShowOlder={setShowOlder}
        selection={{ selected: undefined, onSelect: () => undefined }}
      />
    )
  }

  render(
    <WithActions actions={fakeActions().actions}>
      <Harness />
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
  it('orders state sections and collapses idle sessions', () => {
    renderBoard(
      [
        sessionRecord('ses_run', { title: 'Fleet watcher', updated: now - hour }),
        sessionRecord('ses_done', {
          title: 'Bump deps',
          idle: now - hour,
          updated: now - hour,
          outcome: 'succeeded'
        }),
        sessionRecord('ses_idle', { title: 'Portless route', ...seen(now - 2 * hour) })
      ],
      ['ses_run']
    )

    expect(
      screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)
    ).toEqual(['Working1', 'Done · unseen1'])

    const idle = screen.getByRole('group', { name: 'Idle sessions' })

    expect(idle.hasAttribute('open')).toBe(false)
    expect(within(idle).getByText('Portless route')).toBeTruthy()
  })

  it('hides idle sessions older than 24h until asked', () => {
    renderBoard([
      sessionRecord('ses_recent', { title: 'Portless route', ...seen(now - 2 * hour) }),
      sessionRecord('ses_old', { title: 'Typo sweep', ...seen(now - 30 * hour) })
    ])

    expect(screen.queryByText('Typo sweep')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 older' }))

    expect(screen.getByText('Typo sweep')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide older than 24h' })).toBeTruthy()
  })

  it('explains an empty fleet', () => {
    renderBoard([])

    expect(screen.getByText(/No OpenCode sessions in the last 24 hours/)).toBeTruthy()
  })
})
