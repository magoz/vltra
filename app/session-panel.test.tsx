import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionPanel } from '@/app/session-panel'
import { fakeActions, itemFor, rowFrom, WithActions } from '@/app/testing/dashboard-fixtures'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow, SessionRecord } from '@/lib/data/fleet/types'

const renderPanel = (row: FleetRow | undefined, actions = fakeActions()) => {
  const onClose = vi.fn<() => void>()

  render(
    <WithActions
      actions={actions.actions}
      rows={row === undefined ? undefined : new Map([[row.id, row]])}
    >
      <SessionPanel
        sessionID="ses_1"
        item={row === undefined ? undefined : itemFor(row)}
        onClose={onClose}
      />
    </WithActions>
  )

  return { onClose, calls: actions.calls }
}

const workingRow = () =>
  rowFrom(
    { sessions: [sessionRecord('ses_1', { title: 'Fleet watcher' })], running: ['ses_1'] },
    'ses_1'
  )

/** Already viewed in OpenCode, so opening the panel posts nothing. */
const doneRow = (fields: Partial<SessionRecord> = {}) =>
  rowFrom(
    {
      sessions: [
        sessionRecord('ses_1', {
          title: 'Rewrite README',
          idle: baseTime + 1,
          viewed: baseTime + 1,
          outcome: 'succeeded',
          ...fields
        })
      ]
    },
    'ses_1'
  )

afterEach(() => {
  cleanup()
})

describe('session panel', () => {
  it("is the session's OpenCode chat under its state and title, nothing else", () => {
    const row = workingRow()

    renderPanel(row)

    expect(screen.getByRole('heading', { name: 'Fleet watcher' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Working' })).toBeTruthy()

    const frame = document.querySelector('iframe')

    expect(frame?.getAttribute('src')).toBe(row.links.web)
    expect(frame?.getAttribute('title')).toBe('Fleet watcher')
    // Messages, asks, follow-ups and Stop are the chat's.
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('offers Done (phone only; desktop has the card), not Reopen, for a finished run', async () => {
    const { calls } = renderPanel(doneRow())

    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()

    expect(screen.getByRole('button', { name: 'Done' }).className).toContain('lg:hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_1' } }])
    )
  })

  it('offers Reopen for a handled run', async () => {
    const { calls } = renderPanel(doneRow({ handled: baseTime + 1 }))

    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_1' } }])
    )
  })

  it.each([
    ['finished', {}],
    ['handled', { handled: baseTime + 1 }]
  ] as const)(
    'offers neither Handled nor Reopen for a %s run whose folder is gone',
    (_, fields) => {
      const row = rowFrom(
        {
          sessions: [
            sessionRecord('ses_1', {
              title: 'Scratch',
              directory: '/tmp/tmp.gone',
              idle: baseTime + 1,
              viewed: baseTime + 1,
              outcome: 'succeeded',
              ...fields
            })
          ]
        },
        'ses_1',
        {},
        ['/tmp/tmp.gone']
      )

      renderPanel(row)

      expect(row.state).toBe('handled')
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
    }
  )

  it('opens the session in the terminal or in a new tab', () => {
    const row = doneRow()

    renderPanel(row)

    expect(screen.getByRole('link', { name: 'Open in terminal' }).getAttribute('href')).toBe(
      'ocb://session/ses_1'
    )

    const tab = screen.getByRole('link', { name: 'Open in new tab' })

    expect(tab.getAttribute('href')).toBe(row.links.web)
    expect(tab.getAttribute('target')).toBe('_blank')
  })

  it('marks the latest run viewed in OpenCode when opened, if it is unread there', async () => {
    const { calls } = renderPanel(doneRow({ viewed: undefined }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'markViewed', input: { sessionID: 'ses_1' } }])
    )

    cleanup()

    const older = renderPanel(doneRow({ viewed: baseTime }))

    await vi.waitFor(() =>
      expect(older.calls).toEqual([{ action: 'markViewed', input: { sessionID: 'ses_1' } }])
    )
  })

  it('does not mark viewed a run already viewed, or a session that never ran', () => {
    expect(renderPanel(doneRow({ handled: baseTime + 1 })).calls).toEqual([])

    cleanup()

    expect(renderPanel(rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1')).calls).toEqual([])
  })

  it('closes from the back button', () => {
    const { onClose } = renderPanel(doneRow())

    fireEvent.click(screen.getByRole('button', { name: 'Back to Fleet' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('has no chat for a session that is not on the board', () => {
    renderPanel(undefined)

    expect(screen.getByRole('heading', { name: 'ses_1' })).toBeTruthy()
    expect(
      screen.getByText('This session is not on the board, so Fleet has no OpenCode link for it.')
    ).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
