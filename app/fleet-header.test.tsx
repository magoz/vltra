import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FleetHeader, linkStatus } from '@/app/fleet-header'
import type { FleetConnection, FleetCounts } from '@/lib/data/fleet/types'

const connected: FleetConnection = { status: 'connected', since: 0, failures: 0, version: '2.0.20' }

const counts: FleetCounts = { 'needs-you': 2, failed: 1, working: 3, done: 4, idle: 12 }

afterEach(cleanup)

describe('header', () => {
  it('shows live counts in triage order', () => {
    render(<FleetHeader counts={counts} stream="live" connection={connected} />)

    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '2 need you3 working1 failed4 done12 idle'
    )

    expect(screen.getByRole('status').textContent).toContain('live')
  })

  it('omits zero counts and says when nothing needs you', () => {
    render(
      <FleetHeader
        counts={{ 'needs-you': 0, failed: 0, working: 0, done: 0, idle: 3 }}
        stream="live"
        connection={connected}
      />
    )

    expect(screen.getByLabelText('Session counts').textContent).toBe('nothing needs you3 idle')
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
