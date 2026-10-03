import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CountLine, FleetHeader, linkStatus } from '@/app/fleet-header'
import { fakeActions, WithFleet } from '@/app/testing/dashboard-fixtures'
import type { FleetConnection, FleetCounts } from '@/lib/data/fleet/types'

const connected: FleetConnection = { status: 'connected', since: 0, failures: 0, version: '2.0.20' }

const counts: FleetCounts = { blocked: 2, finished: 4, working: 17, stuck: 2, handled: 12 }

afterEach(cleanup)

const renderHeader = (page: 'agents' | 'projects') =>
  render(
    <WithFleet actions={fakeActions().actions} now={0}>
      <FleetHeader page={page} counts={counts} stream="live" connection={connected} />
    </WithFleet>
  )

describe('header', () => {
  it('shows the title, the page tabs, the count line and the connection', () => {
    renderHeader('agents')

    expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy()

    const tabs = screen.getAllByRole('navigation', { name: 'Pages' })[0]

    if (tabs === undefined) throw new Error('missing page tabs')

    expect(within(tabs).getByRole('link', { name: 'Agents' }).getAttribute('aria-current')).toBe(
      'page'
    )
    expect(within(tabs).getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe(
      '/projects'
    )
    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '6 need you · 17 working · 2 stuck'
    )
    expect(screen.getByRole('status').textContent).toContain('live')
  })

  it("shows each page's keys", () => {
    renderHeader('agents')

    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toBe(
      'j k move · ← → column · ↵ open · h handled · u undo · a d allow/deny · / filter · 1 2 pages'
    )

    cleanup()
    renderHeader('projects')

    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toBe(
      '← → ↑ ↓ card · j k session · ↵ open · 1 2 pages'
    )
  })
})

describe('count line', () => {
  it('reads N need you · N working · N stuck (need you = blocked + finished)', () => {
    render(<CountLine counts={counts} />)

    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '6 need you · 17 working · 2 stuck'
    )
  })

  it('keeps every count, even at zero', () => {
    render(<CountLine counts={{ blocked: 1, finished: 0, working: 0, stuck: 0, handled: 3 }} />)

    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '1 needs you · 0 working · 0 stuck'
    )
  })
})

describe('connection indicator', () => {
  it('is live only when both the stream and OpenCode are connected', () => {
    expect(linkStatus('live', connected)).toMatchObject({ label: 'live', healthy: true })
    expect(linkStatus('reconnecting', connected)).toMatchObject({
      label: 'reconnecting…',
      healthy: false
    })

    expect(
      linkStatus('live', { ...connected, status: 'disconnected', error: 'connection refused' })
    ).toMatchObject({
      label: 'reconnecting to OpenCode…',
      detail: expect.stringContaining('connection refused'),
      healthy: false
    })
  })
})
