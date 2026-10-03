import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRow } from '@/app/session-row'
import { fakeActions, itemFor, rowFrom, WithFleet } from '@/app/testing/dashboard-fixtures'
import { baseTime, sessionRecord } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow, PendingForm } from '@/lib/data/fleet/types'

const now = baseTime + 5 * 60 * 1000

const renderRow = (row: FleetRow, actions = fakeActions(), place?: string) => {
  const onSelect = vi.fn<(sessionID: string) => void>()

  render(
    <WithFleet
      actions={actions.actions}
      rows={new Map([[row.id, row]])}
      now={now}
      onSelect={onSelect}
    >
      <ul>
        <ProjectRow item={itemFor(row)} now={now} place={place} cursor={false} />
      </ul>
    </WithFleet>
  )

  return { onSelect, calls: actions.calls }
}

const permission = {
  id: 'per_1',
  sessionID: 'ses_1',
  action: 'bash',
  resources: ['pnpm test --run']
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

describe('project rows', () => {
  it('shows marker, title, state label and age, and opens the drawer on click', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1', { title: 'Fleet watcher' })] }, 'ses_1')
    const { onSelect } = renderRow(row)
    const link = screen.getByRole('link', { name: 'Fleet watcher' })

    expect(link.getAttribute('href')).toBe('/?session=ses_1')
    expect(screen.getByRole('img', { name: 'Handled' })).toBeTruthy()
    expect(screen.getByText('handled')).toBeTruthy()
    expect(screen.getByText('5m')).toBeTruthy()

    fireEvent.click(link)

    expect(onSelect).toHaveBeenCalledWith('ses_1')
  })

  it('lets modified clicks follow the link (new tab) instead of opening the drawer', () => {
    const { onSelect } = renderRow(rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1'))

    fireEvent.click(screen.getByRole('link'), { metaKey: true })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('labels a working row with its activity, or why it looks stuck', () => {
    renderRow(
      rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
        activity: { kind: 'tool', tool: 'bash', detail: 'pnpm build' }
      })
    )

    expect(screen.getByText('bash: pnpm build')).toBeTruthy()

    cleanup()

    renderRow(
      rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
        retry: { attempt: 3, at: baseTime, message: 'rate limited' }
      })
    )

    expect(screen.getByText('retrying (3×, rate limited)').className).toContain('text-destructive')

    cleanup()

    renderRow(
      rowFrom({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] }, 'ses_1', {
        activityAt: now - 14 * 60 * 1000
      })
    )

    expect(screen.getByText('quiet 14m')).toBeTruthy()
  })

  it('says what a blocked row waits on', () => {
    const row = rowFrom({ sessions: [sessionRecord('ses_1')], permissions: [permission] }, 'ses_1')

    renderRow(row)

    expect(screen.getByText('blocked · 1 permission').className).toContain('text-attention')
  })

  it('marks a failed run red and names a run OpenCode stopped', () => {
    renderRow(
      rowFrom(
        { sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome: 'failed' })] },
        'ses_1'
      )
    )

    expect(screen.getByText('run failed').className).toContain('text-destructive')
    expect(screen.getByRole('img', { name: 'Finished · failed' })).toBeTruthy()

    cleanup()

    renderRow(
      rowFrom(
        { sessions: [sessionRecord('ses_1', { idle: baseTime + 1, outcome: 'interrupted' })] },
        'ses_1',
        { interrupt: 'inactivity' }
      )
    )

    expect(screen.getByText('stopped by OpenCode')).toBeTruthy()
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

    const { calls } = renderRow(row)

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await waitFor(() =>
      expect(calls).toEqual([{ action: 'reopen', input: { sessionID: 'ses_1' } }])
    )
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

    renderRow(row)

    expect(screen.getByRole('listitem').dataset.state).toBe('handled')
    expect(screen.getByText('folder deleted').className).toContain('text-muted-foreground')
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('has no Reopen for a session that never ran', () => {
    renderRow(rowFrom({ sessions: [sessionRecord('ses_1')] }, 'ses_1'))

    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('shows where it runs before the state label (directory in Other, worktree in the fold)', () => {
    const row = rowFrom(
      { sessions: [sessionRecord('ses_1', { projectID: 'global', directory: '/tmp/scratch' })] },
      'ses_1'
    )

    renderRow(row, fakeActions(), '/tmp/scratch')

    expect(screen.getByText('/tmp/scratch ·', { exact: false }).textContent).toBe(
      '/tmp/scratch · handled'
    )
  })
})
