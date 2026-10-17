import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionPanel } from '@/app/session-panel'
import { fakeActions, itemFor, rowFrom, WithVltra } from '@/app/testing/dashboard-fixtures'
import { baseTime, sessionRecord } from '@/lib/data/vltra/testing/fixtures'
import type { VltraRow, SessionRecord } from '@/lib/data/vltra/types'

const renderPanel = (row: VltraRow | undefined, actions = fakeActions()) => {
  const onClose = vi.fn<() => void>()

  render(
    <WithVltra
      actions={actions.actions}
      rows={row === undefined ? undefined : new Map([[row.id, row]])}
      now={baseTime}
    >
      <SessionPanel
        sessionID="ses_1"
        item={row === undefined ? undefined : itemFor(row)}
        onClose={onClose}
      />
    </WithVltra>
  )

  return { onClose, calls: actions.calls }
}

const workingRow = () =>
  rowFrom(
    { sessions: [sessionRecord('ses_1', { title: 'Vltra watcher' })], running: ['ses_1'] },
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
  vi.unstubAllGlobals()
})

describe('session panel', () => {
  it("is the session's OpenCode chat under its state and title, nothing else", () => {
    const row = workingRow()

    renderPanel(row)

    expect(screen.getByRole('heading', { name: 'Vltra watcher' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Working' })).toBeTruthy()

    const frame = document.querySelector('iframe')

    expect(frame?.getAttribute('src')).toBe(row.links.web)
    expect(frame?.getAttribute('title')).toBe('Vltra watcher')
    // Messages, asks, follow-ups and Stop are the chat's.
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('shows where the session runs beside its title: project, then worktree', () => {
    const row = workingRow()

    render(
      <WithVltra actions={fakeActions().actions} rows={new Map([[row.id, row]])} now={baseTime}>
        <SessionPanel sessionID="ses_1" item={itemFor(row, 'feat-x')} onClose={() => undefined} />
      </WithVltra>
    )

    expect(screen.getByText('vltra · feat-x').getAttribute('title')).toBe(row.directory)
    cleanup()

    renderPanel(row)

    expect(screen.getByText('vltra')).toBeTruthy()
  })

  it("i and ⌘I put the caret in the chat's composer", () => {
    // A phone pointer: no auto-focus on load, only the keys.
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    renderPanel(workingRow())

    const frameDocument = document.querySelector('iframe')?.contentDocument

    if (frameDocument === null || frameDocument === undefined) throw new Error('no frame document')

    // jsdom loads no remote document: write OpenCode's composer in by hand.
    frameDocument.open()
    frameDocument.write(
      '<!doctype html><body><div data-component="composer-editor" contenteditable="true"></div></body>'
    )
    frameDocument.close()

    const editor = frameDocument.querySelector<HTMLElement>('[data-component="composer-editor"]')

    if (editor === null) throw new Error('no editor')

    fireEvent.keyDown(document.body, { key: 'i' })

    expect(frameDocument.activeElement).toBe(editor)

    editor.blur()
    expect(frameDocument.activeElement).not.toBe(editor)

    // ⌘I also from a Vltra field.
    const field = document.createElement('input')

    document.body.append(field)
    fireEvent.keyDown(field, { key: 'i', code: 'KeyI', metaKey: true })
    field.remove()

    expect(frameDocument.activeElement).toBe(editor)
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

    fireEvent.click(screen.getByRole('button', { name: 'Back to Vltra' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('has no chat for a session that is not on the board', () => {
    renderPanel(undefined)

    expect(screen.getByRole('heading', { name: 'ses_1' })).toBeTruthy()
    expect(
      screen.getByText('This session is not on the board, so Vltra has no OpenCode link for it.')
    ).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
