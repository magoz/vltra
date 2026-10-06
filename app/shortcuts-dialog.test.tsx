import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now } from '@/app/testing/fleet-scenario'
import type { FleetScreen } from '@/app/fleet-href'

const renderDashboard = (current: FleetScreen) =>
  render(
    <TestDashboard live={fleetLive()} now={now} actions={fakeActions().actions} screen={current} />
  )

const keys = (dialog: HTMLElement) =>
  Array.from(within(dialog).getByLabelText('Keyboard shortcuts').querySelectorAll('div'), row =>
    Array.from(row.children, cell => cell.textContent).join(' ')
  )

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

describe('shortcuts', () => {
  it("? opens the tab's keys; Escape closes them", async () => {
    renderDashboard('agents')

    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })

    const dialog = await screen.findByRole('dialog', { name: 'Keys · Agents' })

    expect(keys(dialog)).toEqual([
      'j k move',
      '← → column',
      '↵ open',
      'h ⌘D done',
      'u ⌘U undo',
      'n ⌘K new',
      '/ filter',
      '⌘1–9 Nth session (Focus)',
      '1 2 3 4 5 ⌘⌥1–5 tabs',
      'i ⌘I type in the chat',
      'esc close the session',
      "⌘P OpenCode's palette (in the chat)",
      '? ⌘/ shortcuts'
    ])

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('⌘/ opens them too, even from a field (the chat, while typing)', async () => {
    renderDashboard('focus')

    const field = document.createElement('textarea')

    document.body.append(field)
    fireEvent.keyDown(field, { key: '/', code: 'Slash', metaKey: true })
    field.remove()

    expect(await screen.findByRole('dialog', { name: 'Keys · Focus' })).toBeTruthy()
  })

  it("the header's ? opens them too", async () => {
    renderDashboard('projects')

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))

    const dialog = await screen.findByRole('dialog', { name: 'Keys · Projects' })

    expect(keys(dialog)[0]).toBe('← → ↑ ↓ card')
  })
})
