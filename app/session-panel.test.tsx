import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionPanel } from '@/app/session-panel'
import { fakeActions, itemFor, rowFrom, WithActions } from '@/app/testing/dashboard-fixtures'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow, SessionDetail, SessionRecord } from '@/lib/data/fleet/types'

const now = baseTime + 12 * 60 * 1000

const detail: SessionDetail = {
  sessionID: 'ses_1',
  transcript: {
    entries: [
      { id: 'msg_1', role: 'user', text: 'Watch the OpenCode event stream.', at: baseTime },
      { id: 'msg_2:0', role: 'agent', text: 'Added a session store.', at: baseTime + 1 },
      {
        id: 'msg_2:1',
        role: 'tool',
        text: 'bash · pnpm build',
        at: baseTime + 2,
        status: 'running'
      }
    ],
    answer: 'Added a session store.'
  },
  files: [
    { file: 'src/watcher.ts', additions: 84, deletions: 3, status: 'modified' },
    { file: 'src/store.ts', additions: 61, deletions: 0, status: 'added' }
  ]
}

const renderPanel = (row: FleetRow | undefined, actions = fakeActions()) => {
  const onClose = vi.fn<() => void>()

  render(
    <WithActions actions={actions.actions}>
      <SessionPanel
        sessionID="ses_1"
        item={row === undefined ? undefined : itemFor(row)}
        now={now}
        onClose={onClose}
      />
    </WithActions>
  )

  return { onClose, calls: actions.calls }
}

const workingRow = () =>
  rowFrom(
    {
      sessions: [
        sessionRecord('ses_1', { title: 'Fleet watcher', cost: 0.84, model: 'anthropic/opus' }),
        sessionRecord('ses_sub', { parentID: 'ses_1', title: 'find event types', agent: 'explore' })
      ],
      running: ['ses_1']
    },
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(detail)))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('session panel', () => {
  it('shows facts, last messages, changed files and subagents', async () => {
    renderPanel(workingRow())

    expect(screen.getByRole('heading', { name: /Fleet watcher/ })).toBeTruthy()
    expect(screen.getByText('fleet · opus · 12m · $0.84')).toBeTruthy()
    expect(await screen.findByText('Watch the OpenCode event stream.')).toBeTruthy()
    expect(screen.getByText('bash · pnpm build')).toBeTruthy()
    expect(screen.getByText('src/watcher.ts')).toBeTruthy()
    expect(screen.getByText(/Files changed · 2/)).toBeTruthy()
    expect(screen.getByText('find event types')).toBeTruthy()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/fleet/sessions/ses_1',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('offers Interrupt only while running, behind a confirmation', async () => {
    const { calls } = renderPanel(workingRow())

    // One Interrupt in the phone top bar, one in the desktop header.
    const [trigger] = screen.getAllByRole('button', { name: 'Interrupt' })

    if (trigger === undefined) throw new Error('missing Interrupt')

    fireEvent.click(trigger)

    const dialog = await screen.findByRole('alertdialog')

    expect(calls).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Interrupt' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'interrupt', input: { sessionID: 'ses_1' } }])
    )
  })

  it('offers Mark handled, not Interrupt, for a finished run', async () => {
    const { calls } = renderPanel(doneRow())

    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mark handled' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_1' } }])
    )
  })

  it('offers Reopen for a handled run', async () => {
    const { calls } = renderPanel(doneRow({ handled: baseTime + 1 }))

    expect(screen.queryByRole('button', { name: 'Mark handled' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_1' } }])
    )
  })

  it('marks the latest run viewed in OpenCode when opened, if it is unread there', async () => {
    const { calls } = renderPanel(doneRow({ viewed: undefined }))

    await vi.waitFor(() =>
      expect(calls).toEqual([{ action: 'markViewed', input: { sessionID: 'ses_1' } }])
    )
  })

  it('sends a follow-up prompt and clears the box', async () => {
    const { calls } = renderPanel(doneRow())
    const box = screen.getByRole('textbox', { name: 'Follow up' })
    const send = screen.getByRole('button', { name: 'Send' })

    expect(send).toHaveProperty('disabled', true)

    fireEvent.change(box, { target: { value: 'Also add a changelog entry' } })
    fireEvent.click(send)

    await vi.waitFor(() => expect(box).toHaveProperty('value', ''))
    expect(calls).toEqual([
      { action: 'sendPrompt', input: { sessionID: 'ses_1', text: 'Also add a changelog entry' } }
    ])
  })

  it('keeps the prompt text when sending fails', async () => {
    renderPanel(doneRow(), fakeActions('OpenCode is not reachable'))

    const box = screen.getByRole('textbox', { name: 'Follow up' })

    fireEvent.change(box, { target: { value: 'continue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await vi.waitFor(() => expect(box).toHaveProperty('disabled', false))
    expect(box).toHaveProperty('value', 'continue')
  })

  it('has the three ways out: OpenCode web, terminal, and the ocb command', () => {
    renderPanel(doneRow())

    expect(screen.getByRole('link', { name: 'Open in OpenCode' }).getAttribute('href')).toMatch(
      /\/server\/.+\/session\/ses_1$/
    )

    expect(screen.getByRole('link', { name: 'Open in terminal' }).getAttribute('href')).toBe(
      'ocb://session/ses_1'
    )

    expect(screen.getByText('ocb -s ses_1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('closes from the back button', () => {
    const { onClose } = renderPanel(doneRow())

    fireEvent.click(screen.getByRole('button', { name: '‹ Fleet' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('says when OpenCode cannot provide the messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ error: 'OpenCode is not reachable' }, { status: 503 }))
      )
    )

    renderPanel(doneRow())

    expect((await screen.findByRole('alert')).textContent).toBe(
      'OpenCode is not reachable right now.'
    )
  })
})
