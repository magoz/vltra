import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BottomTabs,
  ConnectionLine,
  CountLine,
  FleetHeader,
  linkStatus,
  UsageLine,
  UsagePoolDetail
} from '@/app/fleet-header'
import type { FleetScreen } from '@/app/fleet-href'
import { fakeActions, WithFleet } from '@/app/testing/dashboard-fixtures'
import type { FleetConnection, FleetCounts, UsageSummary } from '@/lib/data/fleet/types'

const connected: FleetConnection = { status: 'connected', since: 0, failures: 0, version: '2.0.20' }

const counts: FleetCounts = { blocked: 2, finished: 4, working: 17, stuck: 2, handled: 12 }

afterEach(cleanup)

const renderHeader = (current: FleetScreen) => {
  render(
    <WithFleet actions={fakeActions().actions} now={0}>
      <FleetHeader screen={current} counts={counts} stream="live" connection={connected} />
    </WithFleet>
  )

  return screen.getByRole('navigation', { name: 'Pages' })
}

const renderTabs = (current: FleetScreen) => {
  render(
    <WithFleet actions={fakeActions().actions} now={0}>
      <BottomTabs screen={current} onNew={() => undefined} />
    </WithFleet>
  )

  return screen.getByRole('navigation', { name: 'Pages' })
}

const tabLinks = (tabs: HTMLElement) =>
  within(tabs)
    .getAllByRole('link')
    .map(link => [link.textContent, link.getAttribute('href')])

const currentTab = (tabs: HTMLElement) =>
  within(tabs)
    .getAllByRole('link')
    .find(link => link.getAttribute('aria-current') === 'page')?.textContent

describe('header', () => {
  it('shows the title, the tabs, the count line and the connection, desktop only', () => {
    const tabs = renderHeader('focus')

    expect(screen.getByRole('banner').className).toContain('max-lg:hidden')
    expect(screen.getByRole('heading', { name: 'Fleet' })).toBeTruthy()
    expect(tabLinks(tabs)).toEqual([
      ['Focus', '/'],
      ['Agents', '/?view=agents'],
      ['Projects', '/?view=projects'],
      ['Stats', '/?view=stats'],
      ['Settings', '/?view=settings']
    ])
    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '6 need you · 17 working · 2 stuck'
    )
    expect(screen.getByRole('status').textContent).toContain('live')
  })

  it('marks the tab showing, with no mode toggle', () => {
    expect(currentTab(renderHeader('focus'))).toBe('Focus')
    expect(screen.queryByRole('group', { name: 'Agents view' })).toBeNull()

    cleanup()

    expect(currentTab(renderHeader('agents'))).toBe('Agents')

    cleanup()

    expect(currentTab(renderHeader('projects'))).toBe('Projects')
  })

  it('keeps the keys behind ?, not in the header', () => {
    render(
      <WithFleet actions={fakeActions().actions} now={0}>
        <FleetHeader
          screen="focus"
          counts={counts}
          stream="live"
          connection={connected}
          onShortcuts={() => undefined}
        />
      </WithFleet>
    )

    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' }).textContent).toBe('?')
    expect(screen.queryByText('handled')).toBeNull()
  })
})

describe('new', () => {
  it('opens the launcher from the header (desktop) and the tab bar + (phone)', () => {
    let opened = 0

    render(
      <WithFleet actions={fakeActions().actions} now={0}>
        <FleetHeader
          screen="focus"
          counts={counts}
          stream="live"
          connection={connected}
          onNew={() => {
            opened += 1
          }}
        />
        <BottomTabs
          screen="focus"
          onNew={() => {
            opened += 1
          }}
        />
      </WithFleet>
    )

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(screen.getByRole('button', { name: 'New (launcher)' }))

    expect(opened).toBe(2)
  })
})

describe('tab bar', () => {
  it("is the phone's chrome: the header's tabs and +", () => {
    const bar = renderTabs('focus')

    expect(bar.className).toContain('lg:hidden')
    expect(tabLinks(bar)).toEqual([
      ['Focus', '/'],
      ['Agents', '/?view=agents'],
      ['Projects', '/?view=projects'],
      ['Stats', '/?view=stats'],
      // A gear where the word does not fit; the name stays for screen readers.
      ['\u2699\uFE0ESettings', '/?view=settings']
    ])
    expect(within(bar).getByRole('link', { name: 'Settings' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'New (launcher)' })).toBeTruthy()
  })

  it('marks the tab showing', () => {
    expect(currentTab(renderTabs('focus'))).toBe('Focus')

    cleanup()

    expect(currentTab(renderTabs('agents'))).toBe('Agents')

    cleanup()

    expect(currentTab(renderTabs('projects'))).toBe('Projects')
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

describe('usage line', () => {
  const hour = 60 * 60 * 1000

  const usage: UsageSummary = {
    pools: [
      {
        provider: 'anthropic',
        name: 'Claude',
        reading: { left: 45, capacity: 100 },
        weeklyResetAt: 5 * 24 * hour,
        stale: false,
        windows: [
          { account: 'me@x.com', label: '5-hour', left: 89, resetsAt: 3 * hour },
          { account: 'me@x.com', label: 'Weekly', left: 45, resetsAt: 5 * 24 * hour }
        ]
      },
      {
        provider: 'codex',
        name: 'Codex',
        // 15% of 200% is 7.5% of the pool: low.
        reading: { left: 15, capacity: 200 },
        stale: false,
        windows: [
          { account: 'a@x.com', label: 'Weekly', left: 0 },
          { account: 'b@x.com', label: 'Weekly', left: 15 }
        ]
      },
      { provider: 'opencode-go', name: 'Go', reading: undefined, stale: true, windows: [] }
    ]
  }

  it("reads each pool's % left and first weekly reset, a low one in red", () => {
    render(<UsageLine usage={usage} now={0} />)

    const line = screen.getByLabelText('Usage left')

    expect(line.textContent).toBe('Claude 45% 5d · Codex 15% · Go –')
    expect(within(line).getByText('45%').className).not.toContain('text-destructive')
    expect(within(line).getByText('15%').className).toContain('text-destructive')
  })

  it("shows a pool's accounts on hover, each window as a bar of what is left", async () => {
    render(<UsageLine usage={usage} now={0} />)

    fireEvent.focus(screen.getByRole('button', { name: /Codex/ }))

    const b = await screen.findByRole('region', { name: 'b@x.com' })

    expect(screen.getByText('15% of 200% left')).toBeTruthy()
    expect(within(b).getByText('15% left').className).not.toContain('text-destructive')
    expect(within(b).getByRole('meter', { name: 'Weekly' }).getAttribute('aria-valuenow')).toBe(
      '15'
    )
    expect(
      within(screen.getByRole('region', { name: 'a@x.com' })).getByText('0% left').className
    ).toContain('text-destructive')
  })

  it('names each window with its time to reset, and says when a pool has no reading', () => {
    const [claude, , go] = usage.pools

    if (claude === undefined || go === undefined) throw new Error('fixture')

    const { container } = render(<UsagePoolDetail pool={claude} now={0} />)

    expect(
      Array.from(
        container.querySelectorAll('[role=meter]'),
        meter => meter.parentElement?.textContent
      )
    ).toEqual(['5-hour3h89% left', 'Weekly5d45% left'])

    cleanup()
    render(<UsagePoolDetail pool={go} now={0} />)

    expect(screen.getByText('unavailable (last reading)')).toBeTruthy()
  })

  it('shows in the header once loaded', () => {
    render(
      <WithFleet actions={fakeActions().actions} now={0}>
        <FleetHeader
          screen="focus"
          counts={counts}
          stream="live"
          connection={connected}
          usage={usage}
          now={0}
        />
      </WithFleet>
    )

    expect(screen.getByLabelText('Usage left')).toBeTruthy()
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

describe('connection line (phone)', () => {
  const lost: FleetConnection = {
    ...connected,
    status: 'disconnected',
    error: 'connection refused'
  }

  const line = () => screen.getByRole('status')

  const wait = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('says nothing while live, nor through a reconnect under 3s', () => {
    const { rerender } = render(<ConnectionLine stream="live" connection={connected} />)

    expect(line().className).toContain('lg:hidden')
    expect(line().textContent).toBe('')

    rerender(<ConnectionLine stream="reconnecting" connection={connected} />)
    wait(2999)

    expect(line().textContent).toBe('')

    rerender(<ConnectionLine stream="live" connection={connected} />)
    wait(5000)

    expect(line().textContent).toBe('')
  })

  it('shows once a reconnect lasts 3s, and goes the moment the link is back', () => {
    const { rerender } = render(<ConnectionLine stream="reconnecting" connection={connected} />)

    wait(3000)

    expect(line().textContent).toContain('reconnecting…')

    rerender(<ConnectionLine stream="live" connection={connected} />)

    expect(line().textContent).toBe('')
  })

  it('names OpenCode when Fleet lost it', () => {
    render(<ConnectionLine stream="live" connection={lost} />)

    wait(3000)

    expect(line().textContent).toContain('reconnecting to OpenCode…')
    expect(line().textContent).toContain('connection refused')
  })

  it('starts the wait over when the page shows again (a woken phone)', () => {
    render(<ConnectionLine stream="reconnecting" connection={connected} />)

    wait(5000)

    expect(line().textContent).toContain('reconnecting…')

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(line().textContent).toBe('')

    wait(2999)

    expect(line().textContent).toBe('')

    wait(1)

    expect(line().textContent).toContain('reconnecting…')
  })
})
