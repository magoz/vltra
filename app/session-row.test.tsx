import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeedsMeRow, ProjectRow } from '@/app/session-row'
import { fakeActions, itemFor, rowFrom, WithActions } from '@/app/testing/dashboard-fixtures'
import { swipeDistance } from '@/app/use-swipe'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow, PendingForm } from '@/lib/data/fleet/types'

const now = baseTime + 5 * 60 * 1000

const renderNeedsMe = (row: FleetRow, actions = fakeActions()) => {
  const onSelect = vi.fn<(sessionID: string) => void>()

  render(
    <WithActions actions={actions.actions} rows={new Map([[row.id, row]])}>
      <ul>
        <NeedsMeRow
          item={itemFor(row, 'feat-panel')}
          now={now}
          selected={false}
          cursor={false}
          onSelect={onSelect}
        />
      </ul>
    </WithActions>
  )

  return { onSelect, calls: actions.calls }
}

const renderProject = (row: FleetRow, actions = fakeActions(), showDirectory = false) => {
  render(
    <WithActions actions={actions.actions} rows={new Map([[row.id, row]])}>
      <ul>
        <ProjectRow
          item={itemFor(row)}
          now={now}
          selected={false}
          showDirectory={showDirectory}
          onSelect={() => undefined}
        />
      </ul>
    </WithActions>
  )

  return { calls: actions.calls }
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

const finishedRow = (outcome: 'succeeded' | 'failed' = 'succeeded') =>
  rowFrom({ sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome })] }, 'ses_1')

/** A touch pointer event; jsdom has no `PointerEvent`, so a mouse event carries the fields. */
const touch = (type: string, clientX: number, clientY = 0) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })

  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    pointerId: { value: 1 }
  })

  return event
}

const swipe = (element: Element, dx: number, dy = 0) => {
  fireEvent(element, touch('pointerdown', 300, 100))
  fireEvent(element, touch('pointermove', 300 + dx / 2, 100 + dy / 2))
  fireEvent(element, touch('pointermove', 300 + dx, 100 + dy))
  fireEvent(element, touch('pointerup', 300 + dx, 100 + dy))
}

beforeEach(() => {
  // Finished rows load their summary; answer with nothing unless a test says otherwise.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sidebar row header', () => {
  it('shows project · worktree, title and age, and opens the panel on click', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1', { title: 'Fleet watcher' })] }, 'ses_1')
    const { onSelect } = renderNeedsMe(row)
    const link = screen.getByRole('link', { name: 'fleet · feat-panelFleet watcher' })

    expect(link.getAttribute('href')).toBe('?session=ses_1')
    expect(screen.getByText('5m')).toBeTruthy()

    fireEvent.click(link)

    expect(onSelect).toHaveBeenCalledWith('ses_1')
  })

  it('lets modified clicks follow the link (new tab) instead of opening the panel', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1')
    const { onSelect } = renderNeedsMe(row)

    fireEvent.click(screen.getByRole('link'), { metaKey: true })

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('blocked sidebar rows', () => {
  it('answers a permission inline: Allow once, Always, Deny', async () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], permissions: [permission] }, 'ses_1')
    const { calls } = renderNeedsMe(row)

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

    renderNeedsMe(row, fakeActions('OpenCode is not reachable'))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deny' })).toHaveProperty('disabled', false)
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders a form question with its options and answers it', async () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], forms: [formatForm] }, 'ses_1')
    const { calls } = renderNeedsMe(row)
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

  it("shows a subagent's request on its parent's row and answers it in place", async () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_root', { title: 'Fleet watcher' }),
          sessionRecord('ses_child', {
            parentID: 'ses_root',
            title: 'write state tests',
            agent: 'explore'
          })
        ],
        permissions: [{ ...permission, sessionID: 'ses_child' }]
      },
      'ses_root'
    )

    const { calls } = renderNeedsMe(row)

    expect(row.state).toBe('blocked')
    expect(screen.getByText('subagent explore asks:')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await waitFor(() =>
      expect(calls).toEqual([
        {
          action: 'replyPermission',
          input: { sessionID: 'ses_child', requestID: 'per_1', decision: 'once' }
        }
      ])
    )
  })
})

describe('finished sidebar rows', () => {
  it('marks a failed run red and offers Handled', async () => {
    const row = finishedRow('failed')
    const { calls } = renderNeedsMe(row)

    expect(row.state).toBe('finished')
    expect(screen.getByText('run failed').className).toContain('text-destructive')
    expect(screen.getByRole('img', { name: 'Finished · failed' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Handled' }))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_1' } }])
    )
  })

  it('labels a run OpenCode stopped for inactivity', () => {
    const row = rowFrom(
      { sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome: 'interrupted' })] },
      'ses_1',
      { interrupt: 'inactivity' }
    )

    renderNeedsMe(row)

    expect(screen.getByText('stopped by OpenCode')).toBeTruthy()
  })

  it("shows a finished run's answer excerpt and change totals", async () => {
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

    renderNeedsMe(finishedRow())

    expect(await screen.findByText('“Updated README and 3 guides.”')).toBeTruthy()

    const facts = screen.getByText('+120').parentElement

    if (facts === null) throw new Error('missing change totals')

    expect(within(facts).getByText('−40')).toBeTruthy()
    expect(facts.textContent).toContain('4 files')
    expect(screen.queryByText('finished')).toBeNull()
  })

  it('marks a finished row handled with a swipe left (touch)', async () => {
    const { calls, onSelect } = renderNeedsMe(finishedRow())
    const row = screen.getByRole('link').parentElement

    if (row === null) throw new Error('missing row')

    swipe(row, -(swipeDistance + 20))
    fireEvent.click(screen.getByRole('link'))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'markHandled', input: { sessionID: 'ses_1' } }])
    )

    // The click that ends a swipe does not open the panel.
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores short and vertical swipes', () => {
    const { calls } = renderNeedsMe(finishedRow())
    const row = screen.getByRole('link').parentElement

    if (row === null) throw new Error('missing row')

    swipe(row, -(swipeDistance - 20))
    swipe(row, -20, 200)

    expect(calls).toEqual([])
  })
})

describe('project rows', () => {
  it('shows live activity, subagents and cost while working', () => {
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

    renderProject(row)

    expect(screen.getByText('bash: pnpm build')).toBeTruthy()
    expect(screen.getByText('2 subagents')).toBeTruthy()
    expect(screen.getByText('$0.84')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the retry of a working run', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      retry: { attempt: 3, at: baseTime, message: 'rate limited' }
    })

    renderProject(row)

    expect(screen.getByText('retrying (3×, rate limited)')).toBeTruthy()
  })

  it('shows quiet Nm after 10 minutes without activity, nothing before', () => {
    const quiet = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      activityAt: now - 14 * 60 * 1000
    })

    renderProject(quiet)

    expect(screen.getByText('quiet 14m')).toBeTruthy()

    cleanup()

    const active = rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
      activityAt: now - 60 * 1000
    })

    renderProject(active)

    expect(screen.queryByText(/quiet|retrying/)).toBeNull()
  })

  it('says what a blocked row waits on', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], permissions: [permission] }, 'ses_1')

    renderProject(row)

    expect(screen.getByText('needs you · 1 permission')).toBeTruthy()
  })

  it('offers Reopen on a handled row', async () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', { idle: baseTime + 1, handled: baseTime + 1, outcome: 'failed' })
        ]
      },
      'ses_1'
    )

    const { calls } = renderProject(row)

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_1' } }])
    )
  })

  it('labels a handled row whose folder is gone, muted, with no Reopen', () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', {
            directory: '/tmp/tmp.gone',
            idle: baseTime + 1,
            handled: baseTime + 1,
            outcome: 'succeeded'
          })
        ]
      },
      'ses_1',
      {},
      ['/tmp/tmp.gone']
    )

    renderProject(row)

    expect(screen.getByText('folder deleted').className).toContain('text-muted-foreground')
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('a finished run whose folder is gone shows as handled, labelled, with no Reopen', () => {
    const row = rowFrom(
      {
        sessions: [
          sessionRecord('ses_1', {
            directory: '/tmp/tmp.gone',
            idle: baseTime + 1,
            outcome: 'failed'
          })
        ]
      },
      'ses_1',
      {},
      ['/tmp/tmp.gone']
    )

    renderProject(row)

    expect(screen.getByRole('listitem').dataset.state).toBe('handled')
    expect(screen.getByText('folder deleted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('has no Reopen for a session that never ran', () => {
    renderProject(rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1'))

    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('shows the directory in the Other group', () => {
    const row = rowFrom(
      { sessions: [sessionRecord('ses_1', { projectID: 'global', directory: '/tmp/scratch' })] },
      'ses_1'
    )

    renderProject(row, fakeActions(), true)

    expect(screen.getByText('/tmp/scratch')).toBeTruthy()
  })
})
