import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now } from '@/app/testing/fleet-scenario'
import { drawerTabKey } from '@/app/use-drawer-tab'

const live = fleetLive()

const webLink = (id: string) => {
  const row = live.rows.get(id)

  if (row === undefined) throw new Error(`no row ${id}`)

  return row.links.web
}

// The drawer opens over the board (and Projects); focus mode shows sessions inline.
const renderDashboard = () =>
  render(<TestDashboard live={live} now={now} actions={fakeActions().actions} view="board" />)

const drawer = () => {
  const found = screen.queryByRole('complementary', { name: 'Session' })

  if (found === null) throw new Error('drawer closed')

  return found
}

const open = (title: string) => {
  const card = screen.getAllByRole('link', { name: title })[0]

  if (card === undefined) throw new Error(`no card ${title}`)

  fireEvent.click(card)
}

const tab = (name: 'Summary' | 'Chat') => within(drawer()).getByRole('tab', { name })

const selectedTab = () =>
  within(drawer())
    .getAllByRole('tab')
    .find(candidate => candidate.getAttribute('aria-selected') === 'true')?.textContent

const iframe = () => drawer().querySelector('iframe')

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

beforeEach(() => {
  // The drawer's Summary loads the session detail; answer with nothing.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('session drawer tabs', () => {
  it('opens on Summary and switches between Summary and Chat', () => {
    renderDashboard()
    open('Wait old')

    expect(selectedTab()).toBe('Summary')
    expect(within(drawer()).getByRole('heading', { name: /Wait old/ })).toBeTruthy()

    fireEvent.click(tab('Chat'))

    expect(selectedTab()).toBe('Chat')
    // The summary stays in the document, hidden.
    expect(within(drawer()).queryByRole('heading', { name: /Wait old/ })).toBeNull()
    expect(within(drawer()).getByRole('tabpanel', { name: 'Chat' })).toBeTruthy()

    fireEvent.click(tab('Summary'))

    expect(selectedTab()).toBe('Summary')
    expect(within(drawer()).getByRole('heading', { name: /Wait old/ })).toBeTruthy()
  })

  it("mounts OpenCode's web UI only once Chat is chosen, framing the session's deep link", () => {
    renderDashboard()
    open('Wait old')

    expect(iframe()).toBeNull()

    fireEvent.click(tab('Chat'))

    const frame = iframe()

    expect(frame?.getAttribute('src')).toBe(webLink('ses_wait_old'))
    expect(frame?.getAttribute('title')).toBe('Wait old')
    expect(frame?.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(within(drawer()).getByText('Loading OpenCode…')).toBeTruthy()

    const chat = within(drawer()).getByRole('tabpanel', { name: 'Chat' })

    // The pairing hint only shows while OpenCode loads; the toolbar opens it in a new tab.
    expect(chat.textContent).toContain(
      `Not signed in? Pair this browser once: opencode pair --url ${new URL(webLink('ses_wait_old')).origin}`
    )
    expect(
      within(drawer()).getByRole('link', { name: 'Open in new tab' }).getAttribute('href')
    ).toBe(webLink('ses_wait_old'))

    if (frame === null) throw new Error('no iframe')

    fireEvent.load(frame)

    expect(within(drawer()).queryByText('Loading OpenCode…')).toBeNull()
    expect(chat.textContent).not.toContain('Not signed in?')
  })

  it('keeps the iframe mounted when going back to Summary', () => {
    renderDashboard()
    open('Wait old')
    fireEvent.click(tab('Chat'))

    const frame = iframe()

    expect(frame).not.toBeNull()

    fireEvent.click(tab('Summary'))

    expect(iframe()).toBe(frame)
    expect(frame?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)

    fireEvent.click(tab('Chat'))

    expect(iframe()).toBe(frame)
  })

  it('drops the iframe when the session changes or the drawer closes', () => {
    renderDashboard()
    open('Wait old')
    fireEvent.click(tab('Chat'))

    const first = iframe()

    expect(first?.getAttribute('src')).toBe(webLink('ses_wait_old'))

    // Back on Summary, another session: nothing mounted until Chat shows again.
    fireEvent.click(tab('Summary'))
    open('Busy run')

    expect(first?.isConnected).toBe(false)
    expect(iframe()).toBeNull()

    // On Chat, another session: a fresh iframe for it.
    fireEvent.click(tab('Chat'))
    open('Done new')

    expect(iframe()?.getAttribute('src')).toBe(webLink('ses_done_new'))

    press('Escape')

    expect(screen.queryByRole('complementary', { name: 'Session' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('remembers the chosen tab in this browser and applies it', () => {
    window.localStorage.setItem(drawerTabKey, 'chat')
    renderDashboard()
    open('Wait old')

    expect(selectedTab()).toBe('Chat')
    expect(iframe()?.getAttribute('src')).toBe(webLink('ses_wait_old'))

    fireEvent.click(tab('Summary'))

    expect(window.localStorage.getItem(drawerTabKey)).toBe('summary')
  })

  it('ignores a stored value that is not a tab', () => {
    window.localStorage.setItem(drawerTabKey, 'transcript')
    renderDashboard()
    open('Wait old')

    expect(selectedTab()).toBe('Summary')
    expect(iframe()).toBeNull()
  })

  it('toggles Summary and Chat with c while the drawer is open, not while typing', () => {
    renderDashboard()

    press('c')
    expect(screen.queryByRole('complementary', { name: 'Session' })).toBeNull()

    open('Wait old')
    press('c')

    expect(selectedTab()).toBe('Chat')
    expect(iframe()).not.toBeNull()

    press('c')

    expect(selectedTab()).toBe('Summary')

    press('c', within(drawer()).getByRole('textbox', { name: 'Follow up' }))

    expect(selectedTab()).toBe('Summary')
  })

  it('widens the drawer on desktop while Chat shows', () => {
    renderDashboard()
    open('Wait old')

    expect(drawer().className).toContain('lg:w-[min(44rem,48vw)]')
    expect(drawer().className).not.toContain('lg:w-[min(64rem,70vw)]')

    fireEvent.click(tab('Chat'))

    expect(drawer().className).toContain('lg:w-[min(64rem,70vw)]')
    expect(drawer().className).not.toContain('lg:w-[min(44rem,48vw)]')

    fireEvent.click(tab('Summary'))

    expect(drawer().className).toContain('lg:w-[min(44rem,48vw)]')
  })

  it('keeps the phone back button above the iframe', () => {
    renderDashboard()
    open('Wait old')
    fireEvent.click(tab('Chat'))

    const back = within(drawer()).getByRole('button', { name: 'Back to Fleet' })
    const frame = iframe()

    if (frame === null) throw new Error('no iframe')

    expect(back.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The iframe is not inside the drawer's scrolling Summary.
    expect(frame.closest('.overflow-y-auto')).toBeNull()
  })
})
