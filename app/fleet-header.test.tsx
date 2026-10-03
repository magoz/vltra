import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FleetHeader, linkStatus } from '@/app/fleet-header'
import { CountLine } from '@/app/needs-me-list'
import type { FleetConnection, FleetCounts } from '@/lib/data/fleet/types'

const connected: FleetConnection = { status: 'connected', since: 0, failures: 0, version: '2.0.20' }

const counts: FleetCounts = { blocked: 2, finished: 4, working: 17, stuck: 2, handled: 12 }

afterEach(cleanup)

describe('header', () => {
  it('shows the title, the key hint and the connection', () => {
    render(<FleetHeader stream="live" connection={connected} />)

    expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy()
    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toBe(
      'j k move · ↵ open · h handled · u undo · a d allow/deny'
    )

    expect(screen.getByRole('status').textContent).toContain('live')
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
