import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now } from '@/app/testing/fleet-scenario'

const live = fleetLive()

const webLink = (id: string) => {
  const row = live.rows.get(id)

  if (row === undefined) throw new Error(`no row ${id}`)

  return row.links.web
}

// Every tab shows the open session itself; Projects' split here (the board's: agents-board.test).
const renderDashboard = () =>
  render(<TestDashboard live={live} now={now} actions={fakeActions().actions} screen="projects" />)

const pane = () => {
  const found = screen.queryByRole('region', { name: 'Session' })

  if (found === null) throw new Error('no session open')

  return found
}

const open = (title: string) => {
  const card = screen.getAllByRole('link', { name: title })[0]

  if (card === undefined) throw new Error(`no card ${title}`)

  fireEvent.click(card)
}

const iframe = () => pane().querySelector('iframe')

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key })

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

describe('session split', () => {
  it("frames the session's OpenCode chat, with a pairing hint until it loads", () => {
    renderDashboard()
    open('Wait old')

    const frame = iframe()

    expect(frame?.getAttribute('src')).toBe(webLink('ses_wait_old'))
    expect(frame?.getAttribute('title')).toBe('Wait old')
    expect(frame?.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(within(pane()).getByText('Loading OpenCode…')).toBeTruthy()
    expect(pane().textContent).toContain(
      `Not signed in? Pair this browser once: opencode pair --url ${new URL(webLink('ses_wait_old')).origin}`
    )
    expect(within(pane()).getByRole('link', { name: 'Open in new tab' }).getAttribute('href')).toBe(
      webLink('ses_wait_old')
    )

    if (frame === null) throw new Error('no iframe')

    fireEvent.load(frame)

    expect(within(pane()).queryByText('Loading OpenCode…')).toBeNull()
    expect(pane().textContent).not.toContain('Not signed in?')
  })

  it('keeps one iframe across sessions, moving it, and drops it when the split closes', () => {
    renderDashboard()
    open('Wait old')

    const first = iframe()

    expect(first?.getAttribute('src')).toBe(webLink('ses_wait_old'))

    open('Done new')

    // Not loaded yet (jsdom loads nothing), so the frame loads the new session's URL.
    expect(iframe()).toBe(first)
    expect(first?.getAttribute('src')).toBe(webLink('ses_done_new'))
    expect(first?.getAttribute('title')).toBe('Done new')

    press('Escape')

    expect(screen.queryByRole('region', { name: 'Session' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('keeps the phone back button above the iframe', () => {
    renderDashboard()
    open('Wait old')

    const back = within(pane()).getByRole('button', { name: 'Back to Fleet' })
    const frame = iframe()

    if (frame === null) throw new Error('no iframe')

    expect(back.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(frame.closest('.overflow-y-auto')).toBeNull()
  })
})
