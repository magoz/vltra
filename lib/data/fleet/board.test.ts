import { describe, expect, it } from '@effect/vitest'
import {
  applyChange,
  boardRow,
  buildBoard,
  fromSnapshot,
  idleWindow,
  worktreeLabel
} from '@/lib/data/fleet/board'
import { fromSnapshot as modelFromSnapshot } from '@/lib/data/fleet/model'
import { buildSnapshot } from '@/lib/data/fleet/snapshot'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetConnection, FleetRow, SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connection: FleetConnection = { status: 'connected', since: baseTime, failures: 0 }

const hour = 60 * 60 * 1000

const now = baseTime + 30 * hour

const fleet = '/home/magoz/dev/repos/fleet'

const worktree = '/home/magoz/.local/share/opencode/worktree/fleet/feat-panel'

const snapshotOf = (sessions: ReadonlyArray<SessionRecord>, running: ReadonlyArray<string> = []) =>
  buildSnapshot(
    modelFromSnapshot({
      ...emptySnapshot,
      sessions,
      running,
      projects: [{ id: 'prj_fleet', name: 'fleet', directory: fleet }],
      worktrees: [{ projectID: 'prj_fleet', directories: [worktree] }],
      permissions: [
        { id: 'per_1', sessionID: 'ses_need', action: 'bash', resources: ['pnpm test'] }
      ]
    }),
    { connection, webUrl, now }
  )

const finished = (at: number) => ({ idle: at, updated: at, outcome: 'succeeded' as const })

const seen = (at: number) => ({ ...finished(at), viewed: at })

const sessions = [
  sessionRecord('ses_need', { updated: now - hour }),
  sessionRecord('ses_run', { updated: now - 2 * hour, directory: worktree }),
  sessionRecord('ses_fail', { ...finished(now - 3 * hour), outcome: 'failed' }),
  sessionRecord('ses_done_old', finished(now - 50 * hour)),
  sessionRecord('ses_done', finished(now - 4 * hour)),
  sessionRecord('ses_idle_recent', seen(now - 5 * hour)),
  sessionRecord('ses_idle_wt', { ...seen(now - 6 * hour), directory: worktree }),
  sessionRecord('ses_idle_old', seen(now - 25 * hour))
]

const live = fromSnapshot(snapshotOf(sessions, ['ses_run']))

const ids = (rows: ReadonlyArray<{ readonly row: FleetRow }>) => rows.map(item => item.row.id)

describe('state-first board', () => {
  const board = buildBoard(live, now, false)

  it('orders sections needs you, failed, working, done; newest first within', () => {
    expect(board.sections.map(section => [section.state, ids(section.rows)])).toEqual([
      ['needs-you', ['ses_need']],
      ['failed', ['ses_fail']],
      ['working', ['ses_run']],
      ['done', ['ses_done', 'ses_done_old']]
    ])
  })

  it('lists idle sessions for 24h after their last activity, grouped project → worktree', () => {
    expect(board.idle).toEqual([
      {
        id: 'prj_fleet',
        name: 'fleet',
        worktrees: [
          { label: undefined, rows: [expect.objectContaining({ worktree: undefined })] },
          { label: 'feat-panel', rows: [expect.objectContaining({ worktree: 'feat-panel' })] }
        ]
      }
    ])

    expect(board.olderIdle).toBe(1)
    expect(board.counts).toEqual({ 'needs-you': 1, failed: 1, working: 1, done: 2, idle: 2 })
  })

  it('shows older idle sessions on request', () => {
    const all = buildBoard(live, now, true)

    expect(all.idle[0]?.worktrees[0]?.rows.map(item => item.row.id)).toEqual([
      'ses_idle_recent',
      'ses_idle_old'
    ])

    expect(all.counts.idle).toBe(3)
  })

  it('an idle session drops out once the window passes', () => {
    const later = buildBoard(live, now - 6 * hour + idleWindow + 1, false)

    expect(later.counts.idle).toBe(1)
  })

  it('omits empty sections', () => {
    const quiet = buildBoard(
      fromSnapshot(snapshotOf([sessionRecord('ses_quiet', seen(now - hour))])),
      now,
      false
    )

    expect(quiet.sections).toEqual([])
  })
})

describe('worktree labels', () => {
  it('omits the project checkout, names worktrees and subdirectories', () => {
    expect(worktreeLabel(live, { projectID: 'prj_fleet', directory: fleet })).toBeUndefined()
    expect(worktreeLabel(live, { projectID: 'prj_fleet', directory: worktree })).toBe('feat-panel')

    const withSubdirectory = fromSnapshot(
      snapshotOf([sessionRecord('ses_sub', { directory: `${fleet}/packages/ui` })])
    )

    expect(
      worktreeLabel(withSubdirectory, { projectID: 'prj_fleet', directory: `${fleet}/packages/ui` })
    ).toBe('packages/ui')
  })
})

describe('row names', () => {
  it("names sessions of OpenCode's global project by their directory", () => {
    const global = fromSnapshot(
      buildSnapshot(
        modelFromSnapshot({
          ...emptySnapshot,
          sessions: [sessionRecord('ses_tmp', { projectID: 'global', directory: '/tmp/scratch' })],
          projects: [{ id: 'global', directory: '/' }]
        }),
        { connection, webUrl, now }
      )
    )

    const row = global.rows.get('ses_tmp')

    if (row === undefined) throw new Error('missing ses_tmp')

    expect(boardRow(global, row)).toMatchObject({ project: 'scratch', worktree: undefined })
  })
})

describe('live changes', () => {
  it('upserts changed rows and removes deleted ones', () => {
    const snapshot = snapshotOf(sessions, ['ses_run'])
    const base = fromSnapshot(snapshot)
    const running = base.rows.get('ses_run')

    if (running === undefined) throw new Error('missing ses_run')

    const { live: next, stale } = applyChange(base, {
      initial: false,
      connection: { ...connection, status: 'disconnected' },
      counts: snapshot.counts,
      rows: [{ ...running, state: 'done', running: false }],
      removed: ['ses_done_old']
    })

    expect(stale).toBe(false)
    expect(next.connection.status).toBe('disconnected')
    expect(next.rows.get('ses_run')?.state).toBe('done')
    expect(next.rows.has('ses_done_old')).toBe(false)
  })

  it('flags rows of unknown projects so the snapshot is reloaded', () => {
    const base = fromSnapshot(snapshotOf(sessions))
    const row = base.rows.get('ses_done')

    if (row === undefined) throw new Error('missing ses_done')

    const { stale } = applyChange(base, {
      initial: false,
      connection,
      counts: buildBoard(base, now, false).counts,
      rows: [{ ...row, id: 'ses_new', projectID: 'prj_new' }],
      removed: []
    })

    expect(stale).toBe(true)
  })
})
