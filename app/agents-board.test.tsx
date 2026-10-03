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
      view="board"
      navigations={navigations}
      {...(options.project === undefined ? {} : { project: options.project })}
    />
  )

  return { calls: actions.calls, navigations }
}

const column = (name: string) => screen.getByRole('region', { name })

const columnIDs = () =>
  Object.fromEntries(
    ['Blocked', 'Finished', 'Working', 'Handled'].map(name => [name, rowIDs(column(name))])
  )

const card = (id: string) => {
  const found = document.querySelector(`main li[data-session="${id}"]`)

  if (!(found instanceof HTMLElement)) throw new Error(`no card ${id}`)

  return found
}

const cursorID = () =>
  document.querySelector('main li[data-cursor="true"]')?.getAttribute('data-session')

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

const drawer = () => screen.queryByRole('complementary', { name: 'Session' })

beforeEach(() => {
  // Finished cards load their summary and the drawer its detail; answer with nothing.
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
  it('puts every session in its state column: oldest wait, oldest finished, stuck first', () => {
    renderBoard()

    expect(columnIDs()).toEqual({
      Blocked: ['ses_wait_old', 'ses_wait_new'],
      Finished: ['ses_done_old', 'ses_done_new'],
      Working: ['ses_run', 'ses_retry', 'ses_busy'],
      Handled: ['ses_tmp', 'ses_handled', 'ses_box']
    })
    expect(screen.getByLabelText('Session counts').textContent).toBe(
      '4 need you · 3 working · 2 stuck'
    )
  })

  it('shows project · worktree on every card, Other sessions by their directory', () => {
    renderBoard()

    expect(within(card('ses_retry')).getByText('fleet · feat-x')).toBeTruthy()
    expect(within(card('ses_run')).getByText('fleet')).toBeTruthy()
    expect(within(card('ses_tmp')).getByText('scratch')).toBeTruthy()
    expect(within(card('ses_retry')).getByText('retrying (2×, rate limited)')).toBeTruthy()
    expect(within(card('ses_run')).getByText('quiet 15m')).toBeTruthy()
  })

  it('moves a card to Handled with a toast, and Undo brings it back', async () => {
    const { calls } = renderBoard()

    fireEvent.click(within(card('ses_done_new')).getByRole('button', { name: 'Handled' }))

    expect(rowIDs(column('Finished'))).toEqual(['ses_done_old'])
    expect(rowIDs(column('Handled'))).toEqual(['ses_tmp', 'ses_done_new', 'ses_handled', 'ses_box'])

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_new' } },
        { action: 'reopen', input: { sessionID: 'ses_done_new' } }
      ])
    )
    expect(rowIDs(column('Finished'))).toEqual(['ses_done_old', 'ses_done_new'])
  })

  it('puts a card back and says why when marking handled fails', async () => {
    renderBoard({ failWith: 'OpenCode is not reachable' })

    fireEvent.click(within(card('ses_done_new')).getByRole('button', { name: 'Handled' }))

    expect(
      await screen.findByText('Could not mark handled: OpenCode is not reachable')
    ).toBeTruthy()
    expect(rowIDs(column('Finished'))).toContain('ses_done_new')
  })

  it('reopens a handled card into Finished', async () => {
    const { calls } = renderBoard()

    fireEvent.click(within(card('ses_handled')).getByRole('button', { name: 'Reopen' }))

    expect(rowIDs(column('Finished'))).toEqual(['ses_done_old', 'ses_handled', 'ses_done_new'])
    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_handled' } }])
    )
  })

  it('keeps Handled to the last 24h and links the rest to Projects', () => {
    const { navigations } = renderBoard()

    // ses_ancient (30 days) is left out.
    const more = within(column('Handled')).getByRole('link', { name: '1 more → Projects' })

    // The mode stays in the URL, so the Agents tab comes back to the board.
    expect(more.getAttribute('href')).toBe('/projects?view=board')

    fireEvent.click(more)

    expect(navigations).toEqual([
      { kind: 'go', page: 'projects', project: undefined, view: 'board' }
    ])
    expect(screen.getByRole('region', { name: 'fleet' })).toBeTruthy()
  })
})

describe('project filter', () => {
  it('narrows every column to the project and shows a chip that clears it', () => {
    const { navigations } = renderBoard({ project: 'prj_fleet' })

    expect(columnIDs()).toEqual({
      Blocked: ['ses_wait_old', 'ses_wait_new'],
      Finished: ['ses_done_old', 'ses_done_new'],
      Working: ['ses_run', 'ses_retry', 'ses_busy'],
      Handled: ['ses_handled']
    })
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveProperty('value', 'prj_fleet')

    fireEvent.click(screen.getByRole('button', { name: 'Clear the fleet filter' }))

    expect(navigations).toEqual([{ kind: 'filter', project: undefined }])
    expect(screen.queryByRole('button', { name: 'Clear the fleet filter' })).toBeNull()
    expect(rowIDs(column('Handled'))).toEqual(['ses_tmp', 'ses_handled', 'ses_box'])
  })

  it('filters from the select, which / focuses', () => {
    const { navigations } = renderBoard()
    const select = screen.getByRole('combobox', { name: 'Project' })

    press('/')

    expect(document.activeElement).toBe(select)
    // Typing in the filter leaves the board's keys alone.
    press('j', select)
    expect(cursorID()).toBe('ses_wait_old')

    fireEvent.change(select, { target: { value: 'other' } })

    expect(navigations).toEqual([{ kind: 'filter', project: 'other' }])
    expect(screen.getByRole('button', { name: 'Clear the Other filter' })).toBeTruthy()
    expect(columnIDs()).toEqual({ Blocked: [], Finished: [], Working: [], Handled: ['ses_tmp'] })
  })
})

describe('keyboard', () => {
  it('starts on the first needs-me card; j / k within a column, ← / → between columns', () => {
    renderBoard()

    expect(cursorID()).toBe('ses_wait_old')

    press('j')
    expect(cursorID()).toBe('ses_wait_new')

    press('ArrowDown')
    expect(cursorID()).toBe('ses_wait_new')

    press('ArrowRight')
    expect(cursorID()).toBe('ses_done_new')

    press('ArrowRight')
    press('ArrowDown')
    expect(cursorID()).toBe('ses_busy')

    press('ArrowLeft')
    press('k')
    expect(cursorID()).toBe('ses_done_old')

    press('ArrowLeft')
    press('ArrowUp')
    expect(cursorID()).toBe('ses_wait_old')
  })

  it('marks the focused card handled with h, moves to the next finished card, u undoes', async () => {
    const { calls } = renderBoard()

    press('ArrowRight')
    expect(cursorID()).toBe('ses_done_old')

    press('h')

    expect(rowIDs(column('Finished'))).toEqual(['ses_done_new'])
    expect(cursorID()).toBe('ses_done_new')

    press('u')

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'markHandled', input: { sessionID: 'ses_done_old' } },
        { action: 'reopen', input: { sessionID: 'ses_done_old' } }
      ])
    )
    expect(rowIDs(column('Finished'))).toEqual(['ses_done_old', 'ses_done_new'])
    expect(cursorID()).toBe('ses_done_old')
  })

  it('leaves blocked cards to their answers: h does nothing there', () => {
    const { calls } = renderBoard()

    press('h')

    expect(calls).toEqual([])
    expect(cursorID()).toBe('ses_wait_old')
  })

  it("approves or denies the focused card's first permission with a / d", async () => {
    const { calls } = renderBoard()

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

  it('ignores the keys while typing and with modifiers', () => {
    const { calls } = renderBoard()
    const input = document.createElement('textarea')

    document.body.append(input)

    try {
      press('j', input)
      press('h', input)
      fireEvent.keyDown(document.body, { key: 'j', metaKey: true })

      expect(cursorID()).toBe('ses_wait_old')
      expect(calls).toEqual([])
    } finally {
      input.remove()
    }
  })

  it('switches pages with 1 / 2', () => {
    const { navigations } = renderBoard()

    press('2')
    expect(screen.getByRole('region', { name: 'Other' })).toBeTruthy()

    press('1')
    expect(column('Blocked')).toBeTruthy()
    expect(navigations).toEqual([
      { kind: 'go', page: 'projects', project: undefined, view: 'board' },
      { kind: 'go', page: 'agents', project: undefined, view: 'board' }
    ])
  })
})

describe('drawer', () => {
  it('opens with Enter on the focused card or a click, and closes with Escape', () => {
    renderBoard()

    expect(drawer()).toBeNull()

    press('Enter')

    expect(
      within(drawer() ?? document.body).getByRole('heading', { name: /Wait old/ })
    ).toBeTruthy()

    press('Escape')
    expect(drawer()).toBeNull()

    fireEvent.click(within(card('ses_busy')).getByRole('link', { name: 'Busy run' }))

    expect(
      within(drawer() ?? document.body).getByRole('heading', { name: /Busy run/ })
    ).toBeTruthy()
    // The cursor follows the click.
    expect(cursorID()).toBe('ses_busy')
  })
})

describe('phone', () => {
  it('shows one column, opening on the first needs-me column with cards', () => {
    renderBoard()

    const tabs = screen.getByRole('tablist', { name: 'Columns' })

    expect(
      within(tabs)
        .getAllByRole('tab')
        .map(tab => tab.textContent)
    ).toEqual(['Blocked 2', 'Finished 2', 'Working 3', 'Handled'])
    expect(within(tabs).getByRole('tab', { name: 'Blocked 2' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(column('Blocked').className).not.toContain('max-lg:hidden')
    expect(column('Finished').className).toContain('max-lg:hidden')

    act(() => within(tabs).getByRole('tab', { name: 'Working 3' }).click())

    expect(column('Working').className).not.toContain('max-lg:hidden')
    expect(column('Blocked').className).toContain('max-lg:hidden')
  })

  it('opens on Finished when nothing is blocked, and on Working when nothing needs me', () => {
    renderBoard({ project: 'prj_box' })

    expect(screen.getByRole('tab', { name: 'Working 0' }).getAttribute('aria-selected')).toBe(
      'true'
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: '' }
    })

    expect(screen.getByRole('tab', { name: 'Blocked 2' }).getAttribute('aria-selected')).toBe(
      'true'
    )

    cleanup()

    const live = fleetLive()
    const rows = new Map(live.rows)

    rows.delete('ses_wait_new')
    rows.delete('ses_wait_old')
    renderBoard({ live: { ...live, rows } })

    expect(screen.getByRole('tab', { name: 'Finished 2' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })
})
