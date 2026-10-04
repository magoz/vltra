import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard, testLocation } from '@/app/testing/dashboard-fixtures'
import type { NavCall } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now, rowIDs } from '@/app/testing/fleet-scenario'
import type { LiveFleet } from '@/lib/data/fleet/board'

const renderFocus = (
  options: {
    readonly project?: string
    readonly session?: string
    readonly live?: LiveFleet
  } = {}
) => {
  const actions = fakeActions()
  const navigations: Array<NavCall> = []
  const live = options.live ?? fleetLive()

  render(
    <TestDashboard
      live={live}
      now={now}
      actions={actions.actions}
      navigations={navigations}
      {...(options.project === undefined ? {} : { project: options.project })}
      {...(options.session === undefined ? {} : { session: options.session })}
    />
  )

  // Opening a session also marks it viewed in OpenCode; these tests follow the other actions.
  const calls = () => actions.calls.filter(call => call.action !== 'markViewed')

  return { calls, navigations, live }
}

/** The fleet without its blocked sessions: two finished ones left to handle. */
const finishedOnly = () => {
  const live = fleetLive()
  const rows = new Map(live.rows)

  rows.delete('ses_wait_old')
  rows.delete('ses_wait_new')

  return { ...live, rows }
}

const webLink = (live: LiveFleet, id: string) => {
  const row = live.rows.get(id)

  if (row === undefined) throw new Error(`no row ${id}`)

  return row.links.web
}

const list = () => screen.getByRole('region', { name: 'Needs you' })

const pane = () => screen.getByRole('region', { name: 'Session' })

const drawer = () => screen.queryByRole('complementary', { name: 'Session' })

const row = (id: string) => {
  const found = list().querySelector(`li[data-session="${id}"]`)

  if (!(found instanceof HTMLElement)) throw new Error(`no row ${id}`)

  return found
}

const open = (title: string) => fireEvent.click(within(list()).getByRole('link', { name: title }))

const iframe = () => pane().querySelector('iframe')

const cursorID = () =>
  list().querySelector('li[data-cursor="true"]')?.getAttribute('data-session') ?? undefined

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

/** The desktop header's tab `name`. */
const headerTab = (name: string) => within(screen.getByRole('banner')).getByRole('link', { name })

/** The phone's tab bar (the desktop header's tabs come first). */
const tabBar = () => {
  const bar = screen.getAllByRole('navigation', { name: 'Pages' })[1]

  if (bar === undefined) throw new Error('no tab bar')

  return bar
}

const tab = (name: string) => within(tabBar()).getByRole('link', { name })

beforeEach(() => {
  // The launcher loads its list; answer with nothing.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('focus mode', () => {
  it('is the default: the needs-me list and a quiet right side, no board', () => {
    renderFocus()

    expect(screen.queryByRole('tablist', { name: 'Columns' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Working' })).toBeNull()
    expect(headerTab('Agents').getAttribute('aria-current')).toBe('page')
    expect(within(pane()).getByText('Pick a session on the left')).toBeTruthy()
    expect(testLocation()).toBe('/')
  })

  it('lists only blocked (longest wait first), then finished (oldest first)', () => {
    renderFocus()

    expect(rowIDs(list())).toEqual(['ses_wait_old', 'ses_wait_new', 'ses_done_old', 'ses_done_new'])
    expect(
      within(list())
        .getAllByRole('heading')
        .map(heading => heading.textContent)
    ).toEqual(['Blocked2', 'Finished2'])
    // Rows are titles (and Handled when finished); asks and run facts are in the chat.
    expect(row('ses_wait_old').textContent).not.toContain('pnpm test per_old')
    expect(within(row('ses_wait_old')).queryByRole('button')).toBeNull()
    expect(within(row('ses_done_old')).getByRole('button', { name: 'Handled' })).toBeTruthy()
    expect(within(row('ses_done_old')).getByRole('img', { name: 'Finished · failed' })).toBeTruthy()
    expect(within(row('ses_done_old')).queryByText('run failed')).toBeNull()
    // Working and handled sessions are not listed, but the count line still has them.
    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '4 need you · 3 working · 2 stuck'
    )
  })

  it('honours the project filter', () => {
    renderFocus({ project: 'other' })

    expect(rowIDs(list())).toEqual([])
    expect(screen.getByRole('button', { name: 'Clear the Other filter' })).toBeTruthy()
    expect(within(pane()).getByText('Nothing needs you')).toBeTruthy()
  })

  it('opens a clicked row inline (no drawer): its OpenCode chat, no Summary tab', () => {
    const { live, calls } = renderFocus()

    open('Done old')

    expect(drawer()).toBeNull()
    expect(within(pane()).getByRole('heading', { name: 'Done old' })).toBeTruthy()
    expect(within(pane()).queryByRole('tab')).toBeNull()
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_old'))
    expect(row('ses_done_old').querySelector('[data-selected="true"]')).not.toBeNull()
    expect(testLocation()).toBe('/?session=ses_done_old')
    // The phone shows it full screen.
    expect(pane().className).toContain('max-lg:fixed')
    expect(calls()).toEqual([])

    open('Wait old')

    expect(within(pane()).getByRole('heading', { name: 'Wait old' })).toBeTruthy()
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_wait_old'))
  })

  it('shows a session opened from elsewhere inline, even when it is not listed', () => {
    const { live } = renderFocus({ session: 'ses_busy' })

    expect(drawer()).toBeNull()
    expect(rowIDs(list())).not.toContain('ses_busy')
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_busy'))
  })

  it('opens the next session when the open one is handled, then the empty state', async () => {
    const { live, calls } = renderFocus({ live: finishedOnly() })

    expect(within(pane()).getByText('Pick a session on the left')).toBeTruthy()

    open('Done old')
    fireEvent.click(within(row('ses_done_old')).getByRole('button', { name: 'Handled' }))

    expect(rowIDs(list())).toEqual(['ses_done_new'])
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_new'))
    expect(testLocation()).toBe('/?session=ses_done_new')

    fireEvent.click(within(row('ses_done_new')).getByRole('button', { name: 'Handled' }))

    expect(rowIDs(list())).toEqual([])
    expect(iframe()).toBeNull()
    expect(within(pane()).getByText('Nothing needs you')).toBeTruthy()
    expect(within(list()).getByText('Nothing needs you.')).toBeTruthy()
    expect(pane().className).toContain('max-lg:hidden')
    await waitFor(() =>
      expect(calls()).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_old' } },
        { action: 'markHandled', input: { sessionID: 'ses_done_new' } }
      ])
    )
  })

  it('leaves the open session alone when another row is handled', () => {
    const { live } = renderFocus()

    open('Done new')
    fireEvent.click(within(row('ses_done_old')).getByRole('button', { name: 'Handled' }))

    expect(rowIDs(list())).toEqual(['ses_wait_old', 'ses_wait_new', 'ses_done_new'])
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_new'))
  })

  it("handles from the chat's toolbar and opens the next session", async () => {
    const { live, calls } = renderFocus({ live: finishedOnly() })

    open('Done old')
    fireEvent.click(within(pane()).getByRole('button', { name: 'Handled' }))

    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_new'))
    expect(testLocation()).toBe('/?session=ses_done_new')
    await waitFor(() =>
      expect(calls()).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_done_old' } }])
    )
  })

  it('goes back to the list from a full-screen session (phone)', () => {
    renderFocus()

    expect(pane().className).toContain('max-lg:hidden')

    open('Wait old')
    fireEvent.click(within(pane()).getByRole('button', { name: 'Back to Fleet' }))

    expect(pane().className).toContain('max-lg:hidden')
    expect(within(pane()).getByText('Pick a session on the left')).toBeTruthy()
    expect(testLocation()).toBe('/')
  })
})

describe('tabs', () => {
  it('switches Agents ↔ Board in place, keeping the filter and the open session', () => {
    const { navigations } = renderFocus({ project: 'prj_fleet', session: 'ses_done_old' })

    expect(drawer()).toBeNull()

    fireEvent.click(headerTab('Board'))

    expect(screen.getByRole('region', { name: 'Working' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
    expect(testLocation()).toBe('/?view=board&project=prj_fleet&session=ses_done_old')
    // On the board, the session is in the drawer.
    expect(drawer()).not.toBeNull()
    expect(headerTab('Board').getAttribute('aria-current')).toBe('page')

    press('b')

    expect(list()).toBeTruthy()
    expect(drawer()).toBeNull()
    expect(testLocation()).toBe('/?project=prj_fleet&session=ses_done_old')

    press('b')

    expect(screen.getByRole('region', { name: 'Working' })).toBeTruthy()
    expect(navigations).toEqual([
      { kind: 'view', view: 'board' },
      { kind: 'view', view: 'focus' },
      { kind: 'view', view: 'board' }
    ])
  })

  it('switches with 1 / 2 / 3: Agents and Board in place, Projects a page switch', () => {
    const { navigations } = renderFocus({ project: 'prj_fleet' })

    expect(screen.queryByRole('group', { name: 'Agents view' })).toBeNull()

    press('2')

    expect(screen.getByRole('region', { name: 'Working' })).toBeTruthy()
    expect(testLocation()).toBe('/?view=board&project=prj_fleet')

    press('3')

    expect(testLocation()).toBe('/projects')
    expect(headerTab('Projects').getAttribute('aria-current')).toBe('page')
    // From Projects, Agents and Board start unfiltered.
    expect(headerTab('Board').getAttribute('href')).toBe('/?view=board')

    press('2')

    expect(screen.getByRole('region', { name: 'Working' })).toBeTruthy()

    press('1')

    expect(list()).toBeTruthy()
    expect(testLocation()).toBe('/')
    expect(navigations).toEqual([
      { kind: 'view', view: 'board' },
      { kind: 'go', page: 'projects', project: undefined, view: 'board' },
      { kind: 'go', page: 'agents', project: undefined, view: 'board' },
      { kind: 'view', view: 'focus' }
    ])
  })

  it("switches with the phone's tabs: the modes in place, Projects and back as page switches", () => {
    const { navigations } = renderFocus({ project: 'prj_fleet' })

    expect(tab('Agents').getAttribute('aria-current')).toBe('page')

    fireEvent.click(tab('Board'))

    expect(screen.getByRole('region', { name: 'Working' })).toBeTruthy()
    expect(testLocation()).toBe('/?view=board&project=prj_fleet')
    expect(tab('Board').getAttribute('aria-current')).toBe('page')

    fireEvent.click(tab('Projects'))

    expect(testLocation()).toBe('/projects')
    expect(tab('Projects').getAttribute('aria-current')).toBe('page')

    // Agents is focus mode, whichever was showing last.
    fireEvent.click(tab('Agents'))

    expect(list()).toBeTruthy()
    expect(testLocation()).toBe('/')
    expect(navigations).toEqual([
      { kind: 'view', view: 'board' },
      { kind: 'go', page: 'projects', project: undefined, view: 'board' },
      { kind: 'go', page: 'agents', project: undefined, view: 'focus' }
    ])
  })
})

describe('keyboard', () => {
  it('j / k move, Enter opens on the right, Escape clears', () => {
    const { live } = renderFocus()

    expect(cursorID()).toBe('ses_wait_old')

    press('j')
    press('ArrowDown')
    press('j')
    press('k')
    expect(cursorID()).toBe('ses_done_old')

    press('Enter')

    expect(drawer()).toBeNull()
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_old'))

    press('Escape')

    expect(iframe()).toBeNull()
    expect(within(pane()).getByText('Pick a session on the left')).toBeTruthy()
    expect(testLocation()).toBe('/')
  })

  it('h marks the focused finished session handled and opens the next; u undoes', async () => {
    const { live, calls } = renderFocus()

    // Blocked sessions are answered, not handled.
    press('h')
    expect(calls()).toEqual([])

    press('j')
    press('j')
    press('h')

    expect(rowIDs(list())).toEqual(['ses_wait_old', 'ses_wait_new', 'ses_done_new'])
    expect(cursorID()).toBe('ses_done_new')
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_new'))

    press('u')

    await waitFor(() =>
      expect(calls()).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_old' } },
        { action: 'reopen', input: { sessionID: 'ses_done_old' } }
      ])
    )
    expect(rowIDs(list())).toEqual(['ses_wait_old', 'ses_wait_new', 'ses_done_old', 'ses_done_new'])
    expect(cursorID()).toBe('ses_done_old')
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_old'))
  })

  it('h handles the open session when the focused row is blocked', async () => {
    const { live, calls } = renderFocus({ session: 'ses_done_new' })

    // Focus starts on the open session.
    expect(cursorID()).toBe('ses_done_new')

    press('k')
    press('k')
    press('k')
    expect(cursorID()).toBe('ses_wait_old')

    press('h')

    await waitFor(() =>
      expect(calls()).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_done_new' } }])
    )
    // The last one: the one before it opens.
    expect(iframe()?.getAttribute('src')).toBe(webLink(live, 'ses_done_old'))
  })

  it('/ focuses the project filter', () => {
    renderFocus()

    press('/')

    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Project' }))
  })
})
