import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCard } from '@/app/agent-card'
import { fakeActions, itemFor, rowFrom, WithFleet } from '@/app/testing/dashboard-fixtures'
import { swipeDistance } from '@/app/use-swipe'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow } from '@/lib/data/fleet/types'

const now = baseTime + 5 * 60 * 1000

const renderCard = (row: FleetRow, actions = fakeActions()) => {
  const onSelect = vi.fn<(sessionID: string) => void>()

  render(
    <WithFleet
      actions={actions.actions}
      rows={new Map([[row.id, row]])}
      now={now}
      onSelect={onSelect}
    >
      <ul>
        <AgentCard item={itemFor(row, 'feat-panel')} cursor={false} />
      </ul>
    </WithFleet>
  )

  return { onSelect, calls: actions.calls }
}

const finishedRow = (outcome: 'succeeded' | 'failed' = 'succeeded') =>
  rowFrom({ sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome })] }, 'ses_1')

/** A touch pointer event; jsdom has no `PointerEvent`, so a mouse event carries the fields. */
const touch = (type: string, clientX: number, clientY = 0) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })

  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    pointerId: { value: 1 }
  })

  return event
}

const swipe = (element: Element, dx: number, dy = 0) => {
  fireEvent(element, touch('pointerdown', 300, 100))
  fireEvent(element, touch('pointermove', 300 + dx / 2, 100 + dy / 2))
  fireEvent(element, touch('pointermove', 300 + dx, 100 + dy))
  fireEvent(element, touch('pointerup', 300 + dx, 100 + dy))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('card header', () => {
  it('shows project · worktree, title and age, and opens the drawer on click', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1', { title: 'Fleet watcher' })] }, 'ses_1')
    const { onSelect } = renderCard(row)
    const link = screen.getByRole('link', { name: 'Fleet watcher' })

    expect(link.getAttribute('href')).toBe('/?session=ses_1')
    expect(screen.getByText('fleet · feat-panel')).toBeTruthy()
    expect(screen.getByText('5m')).toBeTruthy()

    fireEvent.click(link)

    expect(onSelect).toHaveBeenCalledWith('ses_1')
  })

  it('lets modified clicks follow the link (new tab) instead of opening the drawer', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1')
    const { onSelect } = renderCard(row)

    fireEvent.click(screen.getByRole('link'), { metaKey: true })

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('blocked cards', () => {
  it('show the title only: the ask is answered in the chat', () => {
    const row = rowFrom(
      {
        sessions: [sessionRecord('ses_1', { title: 'Fleet watcher' })],
        permissions: [
          { id: 'per_1', sessionID: 'ses_1', action: 'bash', resources: ['pnpm test --run'] }
        ]
      },
      'ses_1'
    )

    renderCard(row)

    expect(row.state).toBe('blocked')
    expect(screen.getByRole('img', { name: 'Blocked' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Fleet watcher' })).toBeTruthy()
    expect(screen.queryByText('pnpm test --run')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('finished cards', () => {
  it('mark a failed run red and offer Handled, with no answer excerpt to load', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()

    vi.stubGlobal('fetch', fetch)

    const row = finishedRow('failed')
    const { calls } = renderCard(row)

    expect(row.state).toBe('finished')
    expect(screen.getByRole('img', { name: 'Finished · failed' })).toBeTruthy()
    expect(screen.queryByText('run failed')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Handled' }))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_1' } }])
    )
  })

  it('marks a finished card handled with a swipe left (touch)', async () => {
    const { calls, onSelect } = renderCard(finishedRow())
    const row = screen.getByRole('link').parentElement

    if (row === null) throw new Error('missing row')

    swipe(row, -(swipeDistance + 20))
    fireEvent.click(screen.getByRole('link'))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_1' } }])
    )

    // The click that ends a swipe does not open the panel.
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores short and vertical swipes', () => {
    const { calls } = renderCard(finishedRow())
    const row = screen.getByRole('link').parentElement

    if (row === null) throw new Error('missing row')

    swipe(row, -(swipeDistance - 20))
    swipe(row, -20, 200)

    expect(calls).toEqual([])
  })
})

describe('working cards', () => {
  it('show no live activity, subagents, cost or buttons', () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', { cost: 0.84 }),
          sessionRecord('ses_a', { parentID: 'ses_1' })
        ],
        running: ['ses_1']
      },
      'ses_1',
      { activity: { kind: 'tool', tool: 'bash', detail: 'pnpm build' } }
    )

    renderCard(row)

    expect(screen.queryByText('bash: pnpm build')).toBeNull()
    expect(screen.queryByText('1 subagent')).toBeNull()
    expect(screen.queryByText('$0.84')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('flag the retry of a working run', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      retry: { attempt: 3, at: baseTime, message: 'rate limited' }
    })

    renderCard(row)

    expect(screen.getByText('retrying (3×, rate limited)').className).toContain('text-destructive')
  })

  it('flag quiet Nm after 10 minutes without activity, nothing before', () => {
    const quiet = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      activityAt: now - 14 * 60 * 1000
    })

    renderCard(quiet)

    expect(screen.getByText('quiet 14m')).toBeTruthy()

    cleanup()

    const active = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      activityAt: now - 60 * 1000
    })

    renderCard(active)

    expect(screen.queryByText(/quiet|retrying/)).toBeNull()
  })
})

describe('handled cards', () => {
  it('offers Reopen', async () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', { idle: baseTime + 1, handled: baseTime + 1, outcome: 'failed' })
        ]
      },
      'ses_1'
    )

    const { calls } = renderCard(row)

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_1' } }])
    )
  })

  it('says "folder deleted" and offers no Reopen once the folder is gone', () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', {
            directory: '/tmp/tmp.gone',
            idle: baseTime + 1,
            outcome: 'failed'
          })
        ]
      },
      'ses_1',
      {},
      ['/tmp/tmp.gone']
    )

    renderCard(row)

    expect(row.state).toBe('handled')
    expect(screen.getByText('folder deleted').className).toContain('text-muted-foreground')
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Handled' })).toBeNull()
  })

  it('has no Reopen for a session that never ran', () => {
    renderCard(rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1'))

    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })
})
