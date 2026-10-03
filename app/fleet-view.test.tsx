import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FleetView } from '@/app/fleet-view'
import { fakeActions, liveFrom, WithActions } from '@/app/testing/dashboard-fixtures'
import { Toaster } from '@/components/ui/sonner'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { PendingPermission, SessionRecord } from '@/lib/data/fleet/types'

const minute = 60_000

const hour = 60 * minute

const now = baseTime + 48 * hour

const fleet = '/home/magoz/dev/repos/fleet'

const finished = (at: number, outcome: 'succeeded' | 'failed' = 'succeeded') => ({
  idle: at,
  outcome
})

const handled = (at: number) => ({ ...finished(at), handled: at })

const ask = (id: string, sessionID: string): PendingPermission => ({
  id,
  sessionID,
  action: 'bash',
  resources: [`pnpm test ${id}`]
})

const sessions: ReadonlyArray<SessionRecord> = [
  sessionRecord('ses_wait_new', { title: 'Wait new', created: now - hour }),
  sessionRecord('ses_wait_old', { title: 'Wait old', created: now - 3 * hour }),
  sessionRecord('ses_done_new', { title: 'Done new', ...finished(now - 30 * minute) }),
  sessionRecord('ses_done_old', { title: 'Done old', ...finished(now - 5 * hour, 'failed') }),
  sessionRecord('ses_run', { title: 'Quiet run', created: now - 2 * hour }),
  sessionRecord('ses_retry', { title: 'Retry run', created: now - 2 * hour }),
  sessionRecord('ses_handled', { title: 'Handled one', ...handled(now - 2 * hour) }),
  sessionRecord('ses_ancient', { title: 'Ancient one', ...handled(now - 30 * 24 * hour) }),
  sessionRecord('ses_tmp', {
    title: 'Scratch',
    projectID: 'global',
    directory: '/tmp/scratch',
    ...handled(now - 10 * minute)
  })
]

const fleetLive = (): LiveFleet =>
  liveFrom(
    {
      sessions,
      running: ['ses_run', 'ses_retry'],
      permissions: [ask('per_new', 'ses_wait_new'), ask('per_old', 'ses_wait_old')],
      projects: [
        { id: 'prj_fleet', name: 'fleet', directory: fleet },
        { id: 'global', directory: '/' }
      ]
    },
    now,
    new Map([
      ['ses_run', { activityAt: now - 15 * minute }],
      ['ses_retry', { retry: { attempt: 2, at: now, message: 'rate limited' } }]
    ])
  )

const renderView = (live = fleetLive(), actions = fakeActions()) => {
  const selection = {
    selected: undefined,
    select: vi.fn<(sessionID: string) => void>(),
    close: vi.fn<() => void>()
  }

  render(
    <WithActions actions={actions.actions}>
      <FleetView live={live} stream="live" now={now} selection={selection} />
      <Toaster theme="light" />
    </WithActions>
  )

  return { calls: actions.calls, selection }
}

const sidebar = () => screen.getByRole('region', { name: 'Needs me' })

const projects = () => screen.getByRole('region', { name: 'Projects' })

const rowIDs = (area: HTMLElement) =>
  Array.from(area.querySelectorAll('li[data-session]'), row => row.getAttribute('data-session'))

const cursorID = () =>
  sidebar().querySelector('li[data-cursor="true"]')?.getAttribute('data-session')

const sidebarRow = (id: string) => {
  const row = sidebar().querySelector(`li[data-session="${id}"]`)

  if (!(row instanceof HTMLElement)) throw new Error(`no sidebar row ${id}`)

  return row
}

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

beforeEach(() => {
  // Finished rows load their summary; answer with nothing.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sidebar (needs me)', () => {
  it('lists blocked rows longest wait first, then finished rows oldest first, nothing else', () => {
    renderView()

    expect(rowIDs(sidebar())).toEqual([
      'ses_wait_old',
      'ses_wait_new',
      'ses_done_old',
      'ses_done_new'
    ])

    expect(within(sidebar()).getByLabelText('Session counts').textContent).toBe(
      '4 need you · 2 working · 2 stuck'
    )
  })

  it('marks handled with a toast, and Undo reopens', async () => {
    const { calls } = renderView()

    fireEvent.click(within(sidebarRow('ses_done_new')).getByRole('button', { name: 'Handled' }))

    expect(rowIDs(sidebar())).not.toContain('ses_done_new')
    expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_done_new' } }])

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_new' } },
        { action: 'reopen', input: { sessionID: 'ses_done_new' } }
      ])
    )

    expect(rowIDs(sidebar())).toContain('ses_done_new')
  })

  it('puts a row back and says why when marking handled fails', async () => {
    renderView(fleetLive(), fakeActions('OpenCode is not reachable'))

    fireEvent.click(within(sidebarRow('ses_done_new')).getByRole('button', { name: 'Handled' }))

    expect(
      await screen.findByText('Could not mark handled: OpenCode is not reachable')
    ).toBeTruthy()
    expect(rowIDs(sidebar())).toContain('ses_done_new')
  })
})

describe('projects', () => {
  it('lists every session with no time limit, needs-me and working before handled', () => {
    renderView()

    const project = within(projects()).getByRole('region', { name: 'fleet' })

    expect(rowIDs(project)).toEqual([
      'ses_wait_new',
      'ses_wait_old',
      'ses_retry',
      'ses_run',
      'ses_done_new',
      'ses_done_old',
      'ses_handled',
      'ses_ancient'
    ])
  })

  it('groups sessions outside any repository as Other, last, with their directory', () => {
    renderView()

    const groups = within(projects()).getAllByRole('region')

    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['fleet', 'Other'])

    const other = groups.at(-1)

    if (other === undefined) throw new Error('missing Other')

    expect(rowIDs(other)).toEqual(['ses_tmp'])
    expect(within(other).getByText('/tmp/scratch')).toBeTruthy()
  })

  it('labels stuck working rows: retrying (n×, reason) and quiet Nm', () => {
    renderView()

    const row = (id: string) => {
      const found = projects().querySelector(`li[data-session="${id}"]`)

      if (!(found instanceof HTMLElement)) throw new Error(`no project row ${id}`)

      return found
    }

    expect(within(row('ses_retry')).getByText('retrying (2×, rate limited)')).toBeTruthy()
    expect(within(row('ses_run')).getByText('quiet 15m')).toBeTruthy()
  })

  it('reopens a handled session into the sidebar', async () => {
    const { calls } = renderView()

    const handledRow = projects().querySelector('li[data-session="ses_handled"]')

    if (!(handledRow instanceof HTMLElement)) throw new Error('missing ses_handled')

    fireEvent.click(within(handledRow).getByRole('button', { name: 'Reopen' }))

    expect(rowIDs(sidebar())).toContain('ses_handled')

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_handled' } }])
    )
  })
})

describe('keyboard', () => {
  it('moves with j / k and opens with Enter', () => {
    const { selection } = renderView()

    expect(cursorID()).toBeUndefined()

    press('j')
    expect(cursorID()).toBe('ses_wait_old')

    press('j')
    press('j')
    expect(cursorID()).toBe('ses_done_old')

    press('k')
    expect(cursorID()).toBe('ses_wait_new')

    press('Enter')
    expect(selection.select).toHaveBeenCalledWith('ses_wait_new')
  })

  it('marks the focused row handled with h, moves to the next, and u undoes it', async () => {
    const { calls } = renderView()

    press('j')
    press('j')
    press('j')
    expect(cursorID()).toBe('ses_done_old')

    press('h')

    expect(rowIDs(sidebar())).not.toContain('ses_done_old')
    expect(cursorID()).toBe('ses_done_new')

    press('u')

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_old' } },
        { action: 'reopen', input: { sessionID: 'ses_done_old' } }
      ])
    )

    expect(rowIDs(sidebar())).toContain('ses_done_old')
    expect(cursorID()).toBe('ses_done_old')
  })

  it('leaves blocked rows to their answers: h does nothing there', () => {
    const { calls } = renderView()

    press('j')
    press('h')

    expect(calls).toEqual([])
    expect(cursorID()).toBe('ses_wait_old')
  })

  it("approves or denies the focused row's first permission with a / d", async () => {
    const { calls } = renderView()

    press('j')
    press('a')
    press('a')
    press('j')
    press('d')

    await waitFor(() =>
      expect(calls).toEqual([
        {
          action: 'replyPermission',
          input: { sessionID: 'ses_wait_old', requestID: 'per_old', decision: 'once' }
        },
        {
          action: 'replyPermission',
          input: { sessionID: 'ses_wait_new', requestID: 'per_new', decision: 'reject' }
        }
      ])
    )
  })

  it('ignores the keys while typing', () => {
    const { calls } = renderView()
    const input = document.createElement('textarea')

    document.body.append(input)

    try {
      press('j', input)
      press('h', input)

      expect(cursorID()).toBeUndefined()
      expect(calls).toEqual([])
    } finally {
      input.remove()
    }
  })
})

describe('phone tabs', () => {
  it('switches between Needs me and Projects', () => {
    renderView()

    const needsTab = screen.getByRole('tab', { name: 'Needs me 4' })
    const projectsTab = screen.getByRole('tab', { name: 'Projects' })

    expect(needsTab.getAttribute('aria-selected')).toBe('true')
    expect(projects().className).toContain('max-lg:hidden')

    act(() => projectsTab.click())

    expect(projectsTab.getAttribute('aria-selected')).toBe('true')
    expect(projects().className).not.toContain('max-lg:hidden')
    expect(sidebar().className).toContain('max-lg:hidden')
  })
})
