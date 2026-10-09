import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import type { NavCall } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now, rowIDs } from '@/app/testing/fleet-scenario'
import type { LiveFleet } from '@/lib/data/fleet/board'

const renderBoard = (
  options: { readonly project?: string; readonly live?: LiveFleet; readonly failWith?: string } = {}
) => {
  const actions = fakeActions(options.failWith)
  const navigations: Array<NavCall> = []

  render(
    <TestDashboard
      live={options.live ?? fleetLive()}
      now={now}
      actions={actions.actions}
      screen="agents"
      navigations={navigations}
      {...(options.project === undefined ? {} : { project: options.project })}
    />
  )

  return { calls: actions.calls, navigations }
}

const column = (name: string) => screen.getByRole('region', { name })

const columnIDs = () =>
  Object.fromEntries(['Need you', 'Working', 'Done'].map(name => [name, rowIDs(column(name))]))

const card = (id: string) => {
  const found = document.querySelector(`main li[data-session="${id}"]`)

  if (!(found instanceof HTMLElement)) throw new Error(`no card ${id}`)

  return found
}

const cursorID = () =>
  document.querySelector('main li[data-cursor="true"]')?.getAttribute('data-session')

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

const pane = () => screen.queryByRole('region', { name: 'Session' })

const projectPicker = () => screen.getByRole('combobox', { name: 'Project' })

const pickProject = async (name: string) => {
  fireEvent.click(projectPicker())
  fireEvent.click(await screen.findByRole('option', { name }))
}

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

describe('columns', () => {
  it('puts every session in its column: blocked then finished need you, stuck first', () => {
    renderBoard()

    expect(columnIDs()).toEqual({
      'Need you': ['ses_wait_new', 'ses_wait_old', 'ses_done_new', 'ses_done_old'],
      Working: ['ses_run', 'ses_retry', 'ses_busy'],
      Done: ['ses_tmp', 'ses_handled', 'ses_box']
    })
    // Blocked cards say so; finished ones do not.
    expect(within(card('ses_wait_old')).getByText('blocked')).toBeTruthy()
    expect(within(card('ses_done_old')).queryByText('blocked')).toBeNull()
    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '4 need you · 3 working · 2 stuck'
    )
  })

  it('shows the project on every card, the worktree under the title, Other sessions by their directory', () => {
    renderBoard()

    expect(within(card('ses_retry')).getByText('fleet')).toBeTruthy()
    expect(within(card('ses_retry')).getByText('feat-x')).toBeTruthy()
    expect(within(card('ses_run')).getByText('fleet')).toBeTruthy()
    expect(within(card('ses_tmp')).getByText('scratch')).toBeTruthy()
    expect(within(card('ses_retry')).getByText('retrying (2×, rate limited)')).toBeTruthy()
    expect(within(card('ses_run')).getByText('quiet 15m')).toBeTruthy()
  })

  it('keeps cards minimal: no asks, answer excerpts or live activity', () => {
    renderBoard()

    expect(within(card('ses_wait_old')).queryByText('pnpm test per_old')).toBeNull()
    expect(within(card('ses_wait_old')).queryByRole('button')).toBeNull()
    expect(within(card('ses_busy')).queryByText('thinking…')).toBeNull()
    expect(within(card('ses_done_old')).queryByText('run failed')).toBeNull()
    // Only the shell's own loads (the launcher list, the usage line): cards fetch nothing.
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toEqual([
      '/api/fleet/launcher',
      '/api/fleet/usage'
    ])
  })

  it('moves a card to Handled with a toast, and Undo brings it back', async () => {
    const { calls } = renderBoard()

    fireEvent.click(within(card('ses_done_new')).getByRole('button', { name: 'Done' }))

    expect(rowIDs(column('Need you'))).toEqual(['ses_wait_new', 'ses_wait_old', 'ses_done_old'])
    expect(rowIDs(column('Done'))).toEqual(['ses_tmp', 'ses_done_new', 'ses_handled', 'ses_box'])

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_new' } },
        { action: 'reopen', input: { sessionID: 'ses_done_new' } }
      ])
    )
    expect(rowIDs(column('Need you'))).toEqual([
      'ses_wait_new',
      'ses_wait_old',
      'ses_done_new',
      'ses_done_old'
    ])
  })

  it('puts a card back and says why when marking handled fails', async () => {
    renderBoard({ failWith: 'OpenCode is not reachable' })

    fireEvent.click(within(card('ses_done_new')).getByRole('button', { name: 'Done' }))

    expect(await screen.findByText('Could not mark done: OpenCode is not reachable')).toBeTruthy()
    expect(rowIDs(column('Need you'))).toContain('ses_done_new')
  })

  it('reopens a handled card into Need you', async () => {
    const { calls } = renderBoard()

    fireEvent.click(within(card('ses_handled')).getByRole('button', { name: 'Reopen' }))

    expect(rowIDs(column('Need you'))).toEqual([
      'ses_wait_new',
      'ses_wait_old',
      'ses_done_new',
      'ses_handled',
      'ses_done_old'
    ])
    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_handled' } }])
    )
  })

  it('keeps Handled to the last 24h and links the rest to Projects', () => {
    const { navigations } = renderBoard()

    // ses_ancient (30 days) is left out.
    const more = within(column('Done')).getByRole('link', { name: '1 more → Projects' })

    expect(more.getAttribute('href')).toBe('/?view=projects')

    fireEvent.click(more)

    expect(navigations).toEqual([{ kind: 'show', screen: 'projects', project: undefined }])
    expect(screen.getByRole('region', { name: 'fleet' })).toBeTruthy()
  })
})

describe('project filter', () => {
  it('narrows every column to the project and shows a chip that clears it', () => {
    const { navigations } = renderBoard({ project: 'prj_fleet' })

    expect(columnIDs()).toEqual({
      'Need you': ['ses_wait_new', 'ses_wait_old', 'ses_done_new', 'ses_done_old'],
      Working: ['ses_run', 'ses_retry', 'ses_busy'],
      Done: ['ses_handled']
    })
    expect(projectPicker().textContent).toBe('fleet')

    fireEvent.click(screen.getByRole('button', { name: 'Clear the fleet filter' }))

    expect(navigations).toEqual([{ kind: 'filter', project: undefined }])
    expect(screen.queryByRole('button', { name: 'Clear the fleet filter' })).toBeNull()
    expect(rowIDs(column('Done'))).toEqual(['ses_tmp', 'ses_handled', 'ses_box'])
  })

  it('filters from the picker, which / opens on its search', async () => {
    const { navigations } = renderBoard()

    expect(projectPicker().textContent).toBe('All projects')

    press('/')

    const search = await screen.findByRole('combobox', { name: 'Search projects' })

    await waitFor(() => expect(document.activeElement).toBe(search))
    // Typing in the search leaves the board's keys alone, and narrows the projects.
    press('j', search)
    expect(cursorID()).toBe('ses_wait_new')
    fireEvent.change(search, { target: { value: 'oth' } })
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Other'])

    fireEvent.click(screen.getByRole('option', { name: 'Other' }))

    expect(navigations).toEqual([{ kind: 'filter', project: 'other' }])
    expect(screen.getByRole('button', { name: 'Clear the Other filter' })).toBeTruthy()
    expect(columnIDs()).toEqual({ 'Need you': [], Working: [], Done: ['ses_tmp'] })
  })
})

describe('keyboard', () => {
  it('starts on the first needs-me card; j / k within a column, ← / → between columns', () => {
    renderBoard()

    expect(cursorID()).toBe('ses_wait_new')

    press('j')
    expect(cursorID()).toBe('ses_wait_old')

    press('j')
    press('ArrowDown')
    press('ArrowDown')
    expect(cursorID()).toBe('ses_done_old')

    press('ArrowRight')
    expect(cursorID()).toBe('ses_busy')

    press('ArrowRight')
    expect(cursorID()).toBe('ses_box')

    press('ArrowLeft')
    press('k')
    expect(cursorID()).toBe('ses_retry')

    press('ArrowLeft')
    press('ArrowUp')
    expect(cursorID()).toBe('ses_wait_new')
  })

  it('marks the focused card handled with h, moves to the next card, u undoes', async () => {
    const { calls } = renderBoard()

    press('j')
    press('j')
    expect(cursorID()).toBe('ses_done_new')

    press('h')

    expect(rowIDs(column('Need you'))).toEqual(['ses_wait_new', 'ses_wait_old', 'ses_done_old'])
    expect(cursorID()).toBe('ses_done_old')

    press('u')

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_new' } },
        { action: 'reopen', input: { sessionID: 'ses_done_new' } }
      ])
    )
    expect(rowIDs(column('Need you'))).toEqual([
      'ses_wait_new',
      'ses_wait_old',
      'ses_done_new',
      'ses_done_old'
    ])
    expect(cursorID()).toBe('ses_done_new')
  })

  it('leaves blocked cards to the chat: h does nothing there', () => {
    const { calls } = renderBoard()

    press('h')

    expect(calls).toEqual([])
    expect(cursorID()).toBe('ses_wait_new')
  })

  it('ignores the keys while typing and with modifiers', () => {
    const { calls } = renderBoard()
    const input = document.createElement('textarea')

    document.body.append(input)

    try {
      press('j', input)
      press('h', input)
      fireEvent.keyDown(document.body, { key: 'j', metaKey: true })

      expect(cursorID()).toBe('ses_wait_new')
      expect(calls).toEqual([])
    } finally {
      input.remove()
    }
  })

  it('switches tabs with 1 / 2 / 3', () => {
    const { navigations } = renderBoard()

    press('3')
    expect(screen.getByRole('region', { name: 'Other' })).toBeTruthy()

    press('2')
    expect(column('Need you')).toBeTruthy()

    press('1')
    expect(screen.queryByRole('region', { name: 'Working' })).toBeNull()
    expect(navigations).toEqual([
      { kind: 'show', screen: 'projects', project: undefined },
      { kind: 'show', screen: 'agents', project: undefined },
      { kind: 'show', screen: 'focus', project: undefined }
    ])
  })
})

describe('split view', () => {
  it('opens the chat beside the columns, switches it from any card, closes with Escape', () => {
    renderBoard()

    expect(pane()).toBeNull()

    press('Enter')

    expect(pane()?.querySelector('iframe')?.getAttribute('title')).toBe('Wait new')
    // Beside the columns: every column still lists its cards.
    expect(columnIDs().Working).toEqual(['ses_run', 'ses_retry', 'ses_busy'])

    fireEvent.click(within(card('ses_busy')).getByRole('link', { name: 'Busy run' }))

    expect(pane()?.querySelector('iframe')?.getAttribute('title')).toBe('Busy run')
    // The cursor follows the click.
    expect(cursorID()).toBe('ses_busy')

    press('Escape')

    expect(pane()).toBeNull()
  })
})

describe('phone', () => {
  it('shows one column, opening on Need you', () => {
    renderBoard()

    const tabs = screen.getByRole('tablist', { name: 'Columns' })

    expect(
      within(tabs)
        .getAllByRole('tab')
        .map(tab => tab.textContent)
    ).toEqual(['Need you 4', 'Working 3', 'Done'])
    expect(
      within(tabs).getByRole('tab', { name: 'Need you 4' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(column('Need you').className).not.toContain('max-lg:hidden')
    expect(column('Working').className).toContain('max-lg:hidden')

    act(() => within(tabs).getByRole('tab', { name: 'Working 3' }).click())

    expect(column('Working').className).not.toContain('max-lg:hidden')
    expect(column('Need you').className).toContain('max-lg:hidden')
  })

  it('closes the picker with Escape, keeping the open chat', async () => {
    renderBoard()
    press('Enter')
    press('/')

    const search = await screen.findByRole('combobox', { name: 'Search projects' })

    press('Escape', search)

    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Search projects' })).toBeNull()
    )
    expect(pane()).not.toBeNull()
  })

  it('opens on Working when nothing needs me', async () => {
    renderBoard({ project: 'prj_box' })

    expect(screen.getByRole('tab', { name: 'Working 0' }).getAttribute('aria-selected')).toBe(
      'true'
    )

    await pickProject('All projects')

    expect(screen.getByRole('tab', { name: 'Need you 4' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })
})
