import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FleetScreen } from '@/app/fleet-href'
import { fakeActions, TestDashboard, testLocation } from '@/app/testing/dashboard-fixtures'
import type { FakeValues, NavCall } from '@/app/testing/dashboard-fixtures'
import {
  anvil,
  fleetDone,
  fleetLive,
  launch,
  launcherFetch,
  now
} from '@/app/testing/fleet-scenario'
import type { LiveFleet } from '@/lib/data/fleet/board'
import type { Launch } from '@/lib/data/fleet/types'

const fleet = '/home/magoz/dev/repos/fleet'

const box = '/home/magoz/dev/repos/box'

const withLaunches = (launches: ReadonlyArray<Launch>): LiveFleet => ({
  ...fleetLive(),
  launches
})

const renderDashboard = (
  options: {
    readonly screen?: FleetScreen
    readonly live?: LiveFleet
    readonly failWith?: string
    readonly values?: Partial<FakeValues>
  } = {}
) => {
  const actions = fakeActions(options.failWith, options.values)
  const navigations: Array<NavCall> = []

  const dashboard = (live: LiveFleet) => (
    <TestDashboard
      live={live}
      now={now}
      actions={actions.actions}
      navigations={navigations}
      screen={options.screen ?? 'focus'}
    />
  )

  const view = render(dashboard(options.live ?? fleetLive()))

  // Opening a session also marks it viewed in OpenCode; these tests follow the other actions.
  const calls = () => actions.calls.filter(call => call.action !== 'markViewed')

  return { calls, navigations, rerender: (live: LiveFleet) => view.rerender(dashboard(live)) }
}

const press = (
  key: string,
  init: { readonly metaKey?: boolean; readonly ctrlKey?: boolean } = {}
) => fireEvent.keyDown(document.body, { key, ...init })

const palette = () => screen.getByRole('dialog')

const options = () => within(palette()).getAllByRole('option')

/** Each palette row as `kind text`, once the list has loaded. */
const rows = () =>
  options().map(option => `${option.getAttribute('data-kind')} ${option.textContent ?? ''}`)

const highlighted = () =>
  options().find(option => option.getAttribute('aria-selected') === 'true')?.textContent

const filter = () => within(palette()).getByRole('textbox', { name: /filter/i })

const loaded = () => waitFor(() => expect(options().length).toBeGreaterThan(1))

const openPalette = async () => {
  press('n')
  await loaded()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(launcherFetch()))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('launcher palette', () => {
  it('opens on n with repositories by activity, their worktrees, and New last', async () => {
    renderDashboard()

    expect(screen.queryByRole('dialog')).toBeNull()

    await openPalette()

    expect(rows().map(row => row.split(' ').slice(0, 2).join(' '))).toEqual([
      'repo fleet4',
      'worktree └',
      'worktree └',
      'worktree └',
      'repo box5h',
      'repo anvil',
      'new +'
    ])
    // Under their repository, worktrees go by branch alone.
    expect(rows()[1]).toBe('worktree └ feat/x#7 open1 working3h')
    expect(rows()[3]).toContain('pi/thing')
    expect(rows()[3]).toContain('pi')
    expect(rows().at(-1)).toBe('new + New worktree in fleet…')
    expect(highlighted()).toContain('fleet')
    expect(document.activeElement).toBe(filter())
  })

  it('opens on ⌘K and Ctrl+K from anywhere, and closes on Escape', async () => {
    renderDashboard({ screen: 'projects' })

    press('k', { metaKey: true })
    await loaded()

    fireEvent.keyDown(filter(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    press('k', { ctrlKey: true })
    await loaded()
  })

  it('fuzzy-filters and opens the highlighted checkout in focus mode', async () => {
    const { calls, navigations } = renderDashboard({ screen: 'projects' })

    await openPalette()

    fireEvent.change(filter(), { target: { value: 'done' } })

    expect(rows()).toEqual([
      'worktree └ fleet · feat/donemerged · retire',
      'new + New worktree in fleet…'
    ])

    fireEvent.keyDown(filter(), { key: 'Enter' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls()).toEqual([{ action: 'openCheckout', input: { directory: fleetDone } }])
    expect(navigations).toEqual([{ kind: 'open', session: 'ses_opened' }])
    expect(testLocation()).toBe('/?session=ses_opened')
  })

  it('moves with ↑ ↓ (and j k from the list); New follows the highlighted repository', async () => {
    renderDashboard()

    await openPalette()

    fireEvent.keyDown(filter(), { key: 'ArrowDown' })
    expect(highlighted()).toContain('feat/x')

    fireEvent.keyDown(filter(), { key: 'j' })
    expect(highlighted()).toContain('feat/x')

    const list = within(palette()).getByRole('listbox')

    fireEvent.keyDown(list, { key: 'j' })
    fireEvent.keyDown(list, { key: 'j' })
    fireEvent.keyDown(list, { key: 'j' })
    expect(highlighted()).toContain('box')
    expect(rows().at(-1)).toBe('new + New worktree in box…')

    fireEvent.keyDown(list, { key: 'k' })
    fireEvent.keyDown(filter(), { key: 'ArrowUp' })
    expect(highlighted()).toContain('feat/done')
    expect(rows().at(-1)).toBe('new + New worktree in fleet…')
  })

  it('starts a new worktree: task, debounced suggestion, editable branch, Create', async () => {
    const { calls } = renderDashboard({
      values: {
        suggest: task => ({ branch: `feat/${task.split(' ')[0] ?? 'x'}`, source: 'model' })
      }
    })

    await openPalette()

    fireEvent.change(filter(), { target: { value: 'anvil' } })
    fireEvent.keyDown(filter(), { key: 'ArrowDown' })
    expect(highlighted()).toBe('+ New worktree in anvil…')
    fireEvent.keyDown(filter(), { key: 'Enter' })

    expect(within(palette()).getByText('New worktree in anvil')).toBeTruthy()

    const task = within(palette()).getByRole('textbox', { name: 'Task' })
    const branch = within(palette()).getByRole('textbox', { name: 'Branch' })
    const create = within(palette()).getByRole('button', { name: 'Create' })

    expect(document.activeElement).toBe(task)
    expect(create.hasAttribute('disabled')).toBe(true)

    fireEvent.change(task, { target: { value: 'palette' } })
    fireEvent.change(task, { target: { value: 'launcher palette' } })

    expect(within(palette()).getByText('suggesting…')).toBeTruthy()

    // One request, 600ms after typing stopped, for the latest text.
    await waitFor(() => expect(branch).toHaveProperty('value', 'feat/launcher'))
    expect(calls()).toEqual([{ action: 'suggestBranch', input: { task: 'launcher palette' } }])
    expect(within(palette()).getByText('suggested')).toBeTruthy()

    fireEvent.change(branch, { target: { value: 'feat/a--b' } })
    expect(within(palette()).queryByText('suggested')).toBeNull()
    expect(within(palette()).getByText(/type\/short-name/)).toBeTruthy()
    expect(create.hasAttribute('disabled')).toBe(true)

    fireEvent.change(branch, { target: { value: 'feat/launcher-palette' } })
    fireEvent.click(create)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls().at(-1)).toEqual({
      action: 'launch',
      input: { repoDir: anvil, branch: 'feat/launcher-palette', task: 'launcher palette' }
    })
    expect(await screen.findByText('Provisioning feat/launcher-palette…')).toBeTruthy()
  })

  it('keeps the step open with the reason when the launch is refused', async () => {
    renderDashboard({ failWith: 'Not a git checkout on Box' })

    await openPalette()

    fireEvent.click(within(palette()).getByText('+ New worktree in fleet…'))
    fireEvent.change(within(palette()).getByRole('textbox', { name: 'Task' }), {
      target: { value: 'x' }
    })
    fireEvent.change(within(palette()).getByRole('textbox', { name: 'Branch' }), {
      target: { value: 'fix/x' }
    })
    fireEvent.click(within(palette()).getByRole('button', { name: 'Create' }))

    expect((await within(palette()).findByRole('alert')).textContent).toBe(
      'Not a git checkout on Box'
    )
  })
})

describe('pending launches', () => {
  const failed = launch({
    id: 'launch-2',
    branch: 'fix/broken',
    status: 'failed',
    error: 'Creating the worktree failed: branch fix/broken already exists',
    updatedAt: now
  })

  it('show in focus mode as Provisioning above Blocked, failures red with dismiss', () => {
    const { calls } = renderDashboard({ live: withLaunches([launch(), failed]) })

    const sidebar = screen.getByRole('region', { name: 'Needs you' })

    expect(
      within(sidebar)
        .getAllByRole('heading')
        .map(heading => heading.textContent)
    ).toEqual(['Provisioning2', 'Blocked2', 'Finished2'])

    const provisioning = within(sidebar).getByRole('region', { name: 'Provisioning' })
    const [first, second] = within(provisioning).getAllByRole('listitem')

    expect(first?.textContent).toContain('feat/palette · fleet')
    expect(first?.textContent).toContain('0:42')
    expect(first?.textContent).toContain('provisioning…')
    expect(within(first ?? provisioning).queryByRole('button', { name: /Dismiss/ })).toBeNull()
    expect(second?.textContent).toContain('branch fix/broken already exists')

    fireEvent.click(within(provisioning).getByRole('button', { name: 'Dismiss fix/broken' }))

    expect(calls()).toEqual([{ action: 'dismissLaunch', input: { id: 'launch-2' } }])
  })

  it('show in the Working column on the board', () => {
    renderDashboard({ screen: 'board', live: withLaunches([launch()]) })

    const working = screen.getByRole('region', { name: 'Working' })

    expect(within(working).getByRole('list', { name: 'Launches' }).textContent).toContain(
      'feat/palette · fleet'
    )
  })

  it('auto-opens a launch started here once ready', async () => {
    const { rerender, navigations } = renderDashboard({ screen: 'projects' })

    await openPalette()

    fireEvent.click(within(palette()).getByText('+ New worktree in fleet…'))
    fireEvent.change(within(palette()).getByRole('textbox', { name: 'Task' }), {
      target: { value: 'Add the launcher palette' }
    })
    await waitFor(() =>
      expect(within(palette()).getByRole('textbox', { name: 'Branch' })).toHaveProperty(
        'value',
        'feat/suggested-name'
      )
    )
    fireEvent.click(within(palette()).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    rerender(withLaunches([launch()]))
    expect(navigations).toEqual([])

    rerender(withLaunches([launch({ status: 'ready', sessionID: 'ses_new' })]))

    await waitFor(() => expect(testLocation()).toBe('/?session=ses_new'))
    expect(navigations).toEqual([{ kind: 'open', session: 'ses_new' }])
  })

  it('stays listed instead when something else was opened meanwhile', async () => {
    const { rerender, navigations } = renderDashboard()

    await openPalette()

    fireEvent.click(within(palette()).getByText('+ New worktree in fleet…'))
    fireEvent.change(within(palette()).getByRole('textbox', { name: 'Task' }), {
      target: { value: 'x' }
    })
    fireEvent.change(within(palette()).getByRole('textbox', { name: 'Branch' }), {
      target: { value: 'feat/x2' }
    })
    fireEvent.click(within(palette()).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    rerender(withLaunches([launch()]))
    fireEvent.click(screen.getByRole('link', { name: 'Done old' }))

    await act(async () => {
      rerender(withLaunches([launch({ status: 'ready', sessionID: 'ses_new' })]))
    })

    expect(navigations).toEqual([])
    expect(testLocation()).toBe('/?session=ses_done_old')

    fireEvent.click(screen.getByRole('button', { name: 'ready · open session' }))
    expect(testLocation()).toBe('/?session=ses_new')
  })
})

describe('Projects', () => {
  const card = (name: string) => screen.getByRole('region', { name })

  const section = (directory: string) => {
    const found = document.querySelector(`main [data-worktree="${directory}"]`)

    if (!(found instanceof HTMLElement)) throw new Error(`no section ${directory}`)

    return found
  }

  it('+ on a card opens the new-worktree step for its repository', async () => {
    renderDashboard({ screen: 'projects' })

    const add = await screen.findByRole('button', { name: 'New worktree in box' })

    expect(within(card('Other')).queryByRole('button', { name: /New worktree/ })).toBeNull()

    fireEvent.click(add)

    expect(await within(palette()).findByText('New worktree in box')).toBeTruthy()
  })

  it('shows each worktree section with its branch, owner and PR state', async () => {
    renderDashboard({ screen: 'projects' })

    await waitFor(() =>
      expect(
        within(card('fleet'))
          .getAllByRole('heading')
          .map(heading => heading.textContent)
      ).toEqual(['feat/x', 'fleet', 'feat/done', 'pi/thing'])
    )

    const open = within(section('/home/magoz/.local/share/opencode/worktree/fleet/feat-x'))

    expect(open.getByRole('link', { name: '#7 open' }).getAttribute('href')).toBe(
      'https://github.com/o/fleet/pull/7'
    )
    expect(within(section(fleetDone)).getByText('merged · retire')).toBeTruthy()

    const pi = within(section('/home/magoz/dev/repos/fleet-pi-thing'))

    expect(pi.getByText('closed · retire')).toBeTruthy()
    expect(pi.getByText('pi')).toBeTruthy()
    expect(pi.queryByRole('button', { name: 'Retire' })).toBeNull()
    expect(within(section(fleet)).queryByRole('button', { name: 'Retire' })).toBeNull()
    expect(within(card('box')).queryAllByRole('heading')).toHaveLength(0)
    expect(box).toBe('/home/magoz/dev/repos/box')
  })

  it('disables Retire with the reason while a session there works', async () => {
    renderDashboard({ screen: 'projects' })

    const retire = await within(
      section('/home/magoz/.local/share/opencode/worktree/fleet/feat-x')
    ).findByRole('button', { name: 'Retire' })

    expect(retire.hasAttribute('disabled')).toBe(true)

    const reason = document.getElementById(retire.getAttribute('aria-describedby') ?? '')

    expect(reason?.textContent).toContain('1 session there is working or blocked')
  })

  it('confirms what happens, then retires with a toast', async () => {
    const { calls } = renderDashboard({ screen: 'projects' })

    await waitFor(() => section(fleetDone))
    fireEvent.click(within(section(fleetDone)).getByRole('button', { name: 'Retire' }))

    const confirm = await screen.findByRole('alertdialog')

    expect(confirm.textContent).toContain('Retire feat/done?')
    expect(confirm.textContent).toContain(fleetDone)
    expect(confirm.textContent).toContain('The branch feat/done is kept.')
    expect(confirm.textContent).toContain('Refused if the checkout has uncommitted')
    expect(calls()).toEqual([])

    fireEvent.click(within(confirm).getByRole('button', { name: 'Retire' }))

    await waitFor(() =>
      expect(calls()).toEqual([
        { action: 'retireWorktree', input: { projectID: 'prj_fleet', directory: fleetDone } }
      ])
    )
    expect(await screen.findByText('Retired feat/done')).toBeTruthy()
  })

  it("shows OpenCode's refusal when retiring fails", async () => {
    renderDashboard({ screen: 'projects', failWith: 'worktree-manage: refusing dirty checkout' })

    await waitFor(() => section(fleetDone))
    fireEvent.click(within(section(fleetDone)).getByRole('button', { name: 'Retire' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Retire' })
    )

    expect(
      await screen.findByText(
        'Could not retire feat/done: worktree-manage: refusing dirty checkout'
      )
    ).toBeTruthy()
  })
})
