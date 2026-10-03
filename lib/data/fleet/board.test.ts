import { describe, expect, it } from '@effect/vitest'
import {
  applyChange,
  boardRow,
  buildBoard,
  fromSnapshot,
  worktreeLabel
} from '@/lib/data/fleet/board'
import { fromSnapshot as modelFromSnapshot } from '@/lib/data/fleet/model'
import { buildSnapshot } from '@/lib/data/fleet/snapshot'
import { quietAfter } from '@/lib/data/fleet/state'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetConnection, FleetRow, SessionRecord } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connection: FleetConnection = { status: 'connected', since: baseTime, failures: 0 }

const hour = 60 * 60 * 1000

const now = baseTime + 30 * hour

const fleet = '/home/magoz/dev/repos/fleet'

const worktree = '/home/magoz/.local/share/opencode/worktree/fleet/feat-panel'

const snapshotOf = (
  sessions: ReadonlyArray<SessionRecord>,
  running: ReadonlyArray<string> = [],
  connectedAt = now - 60_000
) =>
  buildSnapshot(
    modelFromSnapshot(
      {
        ...emptySnapshot,
        sessions,
        running,
        projects: [{ id: 'prj_fleet', name: 'fleet', directory: fleet }],
        worktrees: [{ projectID: 'prj_fleet', directories: [worktree] }],
        permissions: [
          { id: 'per_1', sessionID: 'ses_need', action: 'bash', resources: ['pnpm test'] }
        ]
      },
      connectedAt
    ),
    { connection, webUrl, now }
  )

const finished = (at: number) => ({ idle: at, outcome: 'succeeded' as const })

const handled = (at: number) => ({ ...finished(at), handled: at })

const sessions = [
  sessionRecord('ses_need', { created: now - hour }),
  sessionRecord('ses_run', { created: now - 2 * hour, directory: worktree }),
  sessionRecord('ses_fail', { ...finished(now - 3 * hour), outcome: 'failed' }),
  sessionRecord('ses_done_old', finished(now - 50 * hour)),
  sessionRecord('ses_done', finished(now - 4 * hour)),
  sessionRecord('ses_handled_recent', handled(now - 5 * hour)),
  sessionRecord('ses_handled_wt', { ...handled(now - 6 * hour), directory: worktree }),
  sessionRecord('ses_handled_old', handled(now - 25 * 24 * hour))
]

const live = fromSnapshot(snapshotOf(sessions, ['ses_run']))

const ids = (rows: ReadonlyArray<{ readonly row: FleetRow }>) => rows.map(item => item.row.id)

describe('attention board', () => {
  const board = buildBoard(live, now)

  it('orders sections blocked, finished (oldest first), then working', () => {
    expect(board.sections.map(section => [section.state, ids(section.rows)])).toEqual([
      ['blocked', ['ses_need']],
      ['finished', ['ses_done_old', 'ses_done', 'ses_fail']],
      ['working', ['ses_run']]
    ])
  })

  it('lists every handled session, with no time limit, grouped project → worktree', () => {
    expect(board.handled).toEqual([
      {
        id: 'prj_fleet',
        name: 'fleet',
        worktrees: [
          {
            label: undefined,
            rows: [
              expect.objectContaining({ worktree: undefined }),
              expect.objectContaining({ worktree: undefined })
            ]
          },
          { label: 'feat-panel', rows: [expect.objectContaining({ worktree: 'feat-panel' })] }
        ]
      }
    ])

    expect(board.handled[0]?.worktrees[0]?.rows.map(item => item.row.id)).toEqual([
      'ses_handled_recent',
      'ses_handled_old'
    ])

    expect(board.counts).toEqual({ blocked: 1, finished: 3, working: 1, stuck: 0, handled: 3 })
  })

  it('counts a working session quiet for the threshold as stuck', () => {
    const quiet = fromSnapshot(snapshotOf(sessions, ['ses_run'], now - quietAfter))

    expect(buildBoard(quiet, now).counts.stuck).toBe(1)
    expect(buildBoard(quiet, now - 1).counts.stuck).toBe(0)
  })

  it("lists the project's own checkout before its worktrees", () => {
    const newerWorktree = fromSnapshot(
      snapshotOf([
        sessionRecord('ses_root', handled(now - 5 * hour)),
        sessionRecord('ses_wt', { ...handled(now - hour), directory: worktree })
      ])
    )

    expect(buildBoard(newerWorktree, now).handled[0]?.worktrees.map(item => item.label)).toEqual([
      undefined,
      'feat-panel'
    ])
  })

  it('omits empty sections', () => {
    const calm = buildBoard(
      fromSnapshot(snapshotOf([sessionRecord('ses_calm', handled(now - hour))])),
      now
    )

    expect(calm.sections).toEqual([])
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
        modelFromSnapshot(
          {
            ...emptySnapshot,
            sessions: [
              sessionRecord('ses_tmp', { projectID: 'global', directory: '/tmp/scratch' })
            ],
            projects: [{ id: 'global', directory: '/' }]
          },
          now
        ),
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
      rows: [{ ...running, state: 'finished', running: false }],
      removed: ['ses_done_old']
    })

    expect(stale).toBe(false)
    expect(next.connection.status).toBe('disconnected')
    expect(next.rows.get('ses_run')?.state).toBe('finished')
    expect(next.rows.has('ses_done_old')).toBe(false)
  })

  it('flags rows of unknown projects so the snapshot is reloaded', () => {
    const base = fromSnapshot(snapshotOf(sessions))
    const row = base.rows.get('ses_done')

    if (row === undefined) throw new Error('missing ses_done')

    const { stale } = applyChange(base, {
      initial: false,
      connection,
      counts: buildBoard(base, now).counts,
      rows: [{ ...row, id: 'ses_new', projectID: 'prj_new' }],
      removed: []
    })

    expect(stale).toBe(true)
  })
})
