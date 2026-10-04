import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterPaint, fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now } from '@/app/testing/fleet-scenario'

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

const iframe = () => drawer().querySelector('iframe')

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

describe('session drawer', () => {
  it("frames the session's OpenCode chat, with a pairing hint until it loads", () => {
    renderDashboard()
    open('Wait old')

    const frame = iframe()

    expect(frame?.getAttribute('src')).toBe(webLink('ses_wait_old'))
    expect(frame?.getAttribute('title')).toBe('Wait old')
    expect(frame?.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(within(drawer()).getByText('Loading OpenCode…')).toBeTruthy()
    expect(drawer().textContent).toContain(
      `Not signed in? Pair this browser once: opencode pair --url ${new URL(webLink('ses_wait_old')).origin}`
    )
    expect(
      within(drawer()).getByRole('link', { name: 'Open in new tab' }).getAttribute('href')
    ).toBe(webLink('ses_wait_old'))

    if (frame === null) throw new Error('no iframe')

    fireEvent.load(frame)

    expect(within(drawer()).queryByText('Loading OpenCode…')).toBeNull()
    expect(drawer().textContent).not.toContain('Not signed in?')
  })

  it('drops the iframe when the session changes or the drawer closes', () => {
    renderDashboard()
    open('Wait old')

    const first = iframe()

    expect(first?.getAttribute('src')).toBe(webLink('ses_wait_old'))

    open('Done new')

    expect(first?.isConnected).toBe(false)
    expect(iframe()?.getAttribute('src')).toBe(webLink('ses_done_new'))

    press('Escape')

    expect(screen.queryByRole('complementary', { name: 'Session' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('keeps the open chat until the next paint when switching sessions', async () => {
    render(
      <TestDashboard
        live={live}
        now={now}
        actions={fakeActions().actions}
        view="board"
        session="ses_wait_old"
      />
    )

    const first = iframe()

    open('Done new')

    // Tearing down OpenCode waits until the click has shown on screen.
    expect(first?.isConnected).toBe(true)

    await afterPaint()

    expect(first?.isConnected).toBe(false)
    expect(iframe()?.getAttribute('src')).toBe(webLink('ses_done_new'))
  })

  it('keeps the phone back button above the iframe', () => {
    renderDashboard()
    open('Wait old')

    const back = within(drawer()).getByRole('button', { name: 'Back to Fleet' })
    const frame = iframe()

    if (frame === null) throw new Error('no iframe')

    expect(back.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(frame.closest('.overflow-y-auto')).toBeNull()
  })
})
