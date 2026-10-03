import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import type { NavCall } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now, rowIDs } from '@/app/testing/fleet-scenario'

const renderGrid = () => {
  const actions = fakeActions()
  const navigations: Array<NavCall> = []

  render(
    <TestDashboard
      live={fleetLive()}
      now={now}
      actions={actions.actions}
      page="projects"
      navigations={navigations}
    />
  )

  return { calls: actions.calls, navigations }
}

const projectCard = (name: string) => screen.getByRole('region', { name })

const cards = () =>
  Array.from(document.querySelectorAll('main section[data-project]'), card =>
    card.getAttribute('aria-label')
  )

const cursorCard = () =>
  document.querySelector('main section[data-cursor="true"]')?.getAttribute('aria-label')

const cursorRow = () =>
  document.querySelector('main li[data-cursor="true"]')?.getAttribute('data-session')

const press = (key: string) => fireEvent.keyDown(document.body, { key })

const drawer = () => screen.queryByRole('complementary', { name: 'Session' })

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

describe('project cards', () => {
  it('orders cards by latest activity, Other last', () => {
    renderGrid()

    expect(cards()).toEqual(['fleet', 'box', 'Other'])
  })

  it('lists needs-me and working sessions by worktree, with counts in the header', () => {
    renderGrid()

    const fleet = projectCard('fleet')

    expect(within(fleet).getByRole('link', { name: 'fleet 4 need you · 3 working' })).toBeTruthy()
    expect(
      within(fleet)
        .getAllByRole('heading')
        .map(heading => heading.textContent)
    ).toEqual(['feat-x', 'fleet'])
    expect(rowIDs(fleet)).toEqual([
      'ses_retry',
      'ses_wait_new',
      'ses_wait_old',
      'ses_busy',
      'ses_run',
      'ses_done_new',
      'ses_done_old'
    ])
    expect(within(fleet).getAllByText('blocked · 1 permission')).toHaveLength(2)
    expect(within(fleet).getByText('quiet 15m')).toBeTruthy()
    expect(within(fleet).getByText('run failed')).toBeTruthy()
    // A card with only handled sessions is just its fold.
    expect(rowIDs(projectCard('box'))).toEqual([])
    expect(within(projectCard('box')).getByRole('link', { name: 'box' })).toBeTruthy()
  })

  it('opens the board filtered to the project from the card header', () => {
    const { navigations } = renderGrid()
    const header = within(projectCard('fleet')).getByRole('link', { name: /^fleet/ })

    expect(header.getAttribute('href')).toBe('/?project=prj_fleet')

    fireEvent.click(header)

    expect(navigations).toEqual([{ kind: 'go', page: 'agents', project: 'prj_fleet' }])
    expect(screen.getByRole('button', { name: 'Clear the fleet filter' })).toBeTruthy()
    expect(rowIDs(screen.getByRole('region', { name: 'Handled' }))).toEqual(['ses_handled'])
  })

  it('folds handled sessions into "N handled · last 2h", expandable in place, with Reopen', async () => {
    const { calls } = renderGrid()
    const fleet = projectCard('fleet')
    const fold = within(fleet).getByRole('button', { name: '··· 2 handled · last 2h' })

    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(rowIDs(fleet)).not.toContain('ses_handled')

    fireEvent.click(fold)

    expect(fold.getAttribute('aria-expanded')).toBe('true')

    const handled = within(fleet).getByRole('list', { name: 'fleet handled' })

    // No time limit: the 30-day-old one is there too.
    expect(rowIDs(handled)).toEqual(['ses_handled', 'ses_ancient'])

    const row = handled.querySelector('li[data-session="ses_handled"]')

    if (!(row instanceof HTMLElement)) throw new Error('missing ses_handled')

    fireEvent.click(within(row).getByRole('button', { name: 'Reopen' }))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_handled' } }])
    )
    expect(rowIDs(handled)).toEqual(['ses_ancient'])
    expect(rowIDs(fleet)).toContain('ses_handled')
  })

  it('shows the directory of Other sessions in the fold', () => {
    renderGrid()

    const other = projectCard('Other')

    fireEvent.click(within(other).getByRole('button', { name: '··· 1 handled · last 10m' }))

    expect(within(other).getByText('/tmp/scratch ·', { exact: false })).toBeTruthy()
  })

  it('opens the drawer from a session', () => {
    renderGrid()

    fireEvent.click(within(projectCard('fleet')).getByRole('link', { name: 'Busy run' }))

    expect(
      within(drawer() ?? document.body).getByRole('heading', { name: /Busy run/ })
    ).toBeTruthy()

    press('Escape')
    expect(drawer()).toBeNull()
  })
})

describe('keyboard', () => {
  it('moves between cards with the arrows and within one with j / k', () => {
    renderGrid()

    expect(cursorCard()).toBe('fleet')

    press('ArrowRight')
    expect(cursorCard()).toBe('box')

    press('ArrowDown')
    expect(cursorCard()).toBe('Other')

    press('ArrowDown')
    expect(cursorCard()).toBe('Other')

    press('ArrowLeft')
    press('ArrowUp')
    expect(cursorCard()).toBe('fleet')

    press('j')
    expect(cursorRow()).toBe('ses_retry')

    press('j')
    press('j')
    press('k')
    expect(cursorRow()).toBe('ses_wait_new')
  })

  it('opens the focused session with Enter, else the card board', () => {
    const { navigations } = renderGrid()

    press('j')
    press('Enter')

    expect(
      within(drawer() ?? document.body).getByRole('heading', { name: /Retry run/ })
    ).toBeTruthy()

    press('Escape')
    press('ArrowRight')
    press('Enter')

    expect(navigations).toEqual([{ kind: 'go', page: 'agents', project: 'prj_box' }])
    expect(screen.getByRole('button', { name: 'Clear the box filter' })).toBeTruthy()
  })
})
