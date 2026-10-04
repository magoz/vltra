import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomTabs, ConnectionLine, CountLine, FleetHeader, linkStatus } from '@/app/fleet-header'
import type { FleetScreen } from '@/app/fleet-href'
import { fakeActions, WithFleet } from '@/app/testing/dashboard-fixtures'
import type { FleetConnection, FleetCounts } from '@/lib/data/fleet/types'

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
      ['Projects', '/?view=projects']
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

  it("shows each tab's keys", () => {
    renderHeader('focus')

    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toBe(
      'j k move · ↵ open · h handled · u undo · b agents · n ⌘K new · / filter · 1 2 3 tabs'
    )

    cleanup()
    renderHeader('agents')

    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toBe(
      'j k move · ← → column · ↵ open · h handled · u undo · b focus · n ⌘K new · / filter · 1 2 3 tabs'
    )

    cleanup()
    renderHeader('projects')

    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toBe(
      '← → ↑ ↓ card · j k session · ↵ open · n ⌘K new · 1 2 3 tabs'
    )
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
      ['Projects', '/?view=projects']
    ])
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
