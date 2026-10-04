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
      'h done',
      'u undo',
      'b focus',
      'n ⌘K new',
      '/ filter',
      '⌘1–9 Nth session (Focus)',
      '1 2 3 ⌘⌥1–3 tabs',
      'esc close the session',
      '? shortcuts'
    ])

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it("the header's ? opens them too", async () => {
    renderDashboard('projects')

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))

    const dialog = await screen.findByRole('dialog', { name: 'Keys · Projects' })

    expect(keys(dialog)[0]).toBe('← → ↑ ↓ card')
  })
})
