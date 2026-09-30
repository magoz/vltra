import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRow } from '@/app/session-row'
import { fakeActions, itemFor, rowFrom, WithActions } from '@/app/testing/dashboard-fixtures'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow, PendingForm } from '@/lib/data/fleet/types'

const now = baseTime + 5 * 60 * 1000

const renderRow = (row: FleetRow, actions = fakeActions()) => {
  const onSelect = vi.fn<(sessionID: string) => void>()

  render(
    <WithActions actions={actions.actions}>
      <ul>
        <SessionRow
          item={itemFor(row, 'feat-panel')}
          now={now}
          selected={false}
          onSelect={onSelect}
        />
      </ul>
    </WithActions>
  )

  return { onSelect, calls: actions.calls }
}

const permission = {
  id: 'per_1',
  sessionID: 'ses_1',
  action: 'bash',
  resources: ['pnpm test --run']
}

const formatForm: PendingForm = {
  id: 'frm_1',
  sessionID: 'ses_1',
  title: 'Export docs',
  fields: [
    {
      key: 'format',
      type: 'string',
      title: 'Which format?',
      required: true,
      options: [
        { value: 'pdf', label: 'PDF' },
        { value: 'docx', label: 'DOCX' }
      ]
    }
  ]
}

beforeEach(() => {
  // Done rows load their summary; answer with nothing unless a test says otherwise.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('row header', () => {
  it('shows project · worktree · title, age and model, and opens the panel on click', () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', { title: 'Fleet watcher', model: 'anthropic/claude-opus-5' })
        ]
      },
      'ses_1'
    )

    const { onSelect } = renderRow(row)
    const link = screen.getByRole('link', { name: 'fleet · feat-panel Fleet watcher' })

    expect(link.getAttribute('href')).toBe('?session=ses_1')
    expect(screen.getByText('5m')).toBeTruthy()
    expect(screen.getByText(/claude-opus-5/)).toBeTruthy()

    fireEvent.click(link)

    expect(onSelect).toHaveBeenCalledWith('ses_1')
  })

  it('lets modified clicks follow the link (new tab) instead of opening the panel', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1')
    const { onSelect } = renderRow(row)

    fireEvent.click(screen.getByRole('link'), { metaKey: true })

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('needs you', () => {
  it('answers a permission inline: Allow once, Always, Deny', async () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], permissions: [permission] }, 'ses_1')
    const { calls } = renderRow(row)

    expect(screen.getByText('pnpm test --run')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Always' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Allowed once')
    expect(calls).toEqual([
      {
        action: 'replyPermission',
        input: { sessionID: 'ses_1', requestID: 'per_1', decision: 'once' }
      }
    ])
  })

  it('keeps the buttons and reports failures', async () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], permissions: [permission] }, 'ses_1')

    renderRow(row, fakeActions('OpenCode is not reachable'))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deny' })).toHaveProperty('disabled', false)
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders a form question with its options and answers it', async () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], forms: [formatForm] }, 'ses_1')
    const { calls } = renderRow(row)
    const answer = screen.getByRole('button', { name: 'Answer' })

    expect(screen.getByText('Which format?', { selector: 'p' })).toBeTruthy()
    // Required and unanswered: Answer waits for a choice.
    expect(answer).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('radio', { name: /DOCX/ }))
    fireEvent.click(answer)

    expect(await screen.findByText('Answered')).toBeTruthy()
    expect(calls).toEqual([
      {
        action: 'replyForm',
        input: { sessionID: 'ses_1', formID: 'frm_1', answer: { format: 'docx' } }
      }
    ])
  })

  it("shows a subagent's pending request on its root row", () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_root', { title: 'Fleet watcher' }),
          sessionRecord('ses_child', { parentID: 'ses_root', title: 'write state tests' })
        ],
        permissions: [{ ...permission, sessionID: 'ses_child' }]
      },
      'ses_root'
    )

    renderRow(row)

    expect(row.state).toBe('needs-you')
    expect(screen.getByText(/write state tests ·/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
  })
})

describe('working', () => {
  it('shows live activity, subagents and cost', () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', { cost: 0.84 }),
          sessionRecord('ses_a', { parentID: 'ses_1' }),
          sessionRecord('ses_b', { parentID: 'ses_1' })
        ],
        running: ['ses_1']
      },
      'ses_1',
      { activity: { kind: 'tool', tool: 'bash', detail: 'pnpm build' } }
    )

    renderRow(row)

    expect(screen.getByText('bash: pnpm build')).toBeTruthy()
    expect(screen.getByText('2 subagents')).toBeTruthy()
    expect(screen.getByText('$0.84')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says thinking… between tool calls', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      activity: { kind: 'thinking' }
    })

    renderRow(row)

    expect(screen.getByText('thinking…')).toBeTruthy()
  })
})

describe('failed and done', () => {
  it('shows the retry reason of a failing run', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      stepFailed: true,
      retry: { attempt: 3, at: baseTime, message: 'rate limited' }
    })

    renderRow(row)

    expect(row.state).toBe('failed')
    expect(screen.getByText('rate limited (retry 3)')).toBeTruthy()
  })

  it('offers Mark seen on an unseen failed run', async () => {
    const row = rowFrom(
      {
        sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome: 'failed' })]
      },
      'ses_1'
    )

    const { calls } = renderRow(row)

    expect(screen.getByText('last run failed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Mark seen' }))

    expect(await screen.findByRole('button', { name: 'Seen' })).toHaveProperty('disabled', true)
    expect(calls).toEqual([{ action: 'markSeen', input: { sessionID: 'ses_1' } }])
  })

  it("shows a done run's answer excerpt and change totals", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            sessionID: 'ses_1',
            idle: baseTime + 1,
            answer: 'Updated README and 3 guides.',
            changes: { files: 4, additions: 120, deletions: 40 }
          })
        )
      )
    )

    const row = rowFrom(
      { sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome: 'succeeded' })] },
      'ses_1'
    )

    renderRow(row)

    expect(await screen.findByText('“Updated README and 3 guides.”')).toBeTruthy()

    const facts = screen.getByText('+120').parentElement

    if (facts === null) throw new Error('missing change totals')

    expect(within(facts).getByText('−40')).toBeTruthy()
    expect(facts.textContent).toContain('4 files')
    expect(screen.getByRole('button', { name: 'Mark seen' })).toBeTruthy()
  })
})
