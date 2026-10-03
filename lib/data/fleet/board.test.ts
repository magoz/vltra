import { describe, expect, it } from '@effect/vitest'
import {
  applyChange,
  boardRow,
  buildBoard,
  fromSnapshot,
  withOverrides,
  worktreeLabel
} from '@/lib/data/fleet/board'
import type { BoardRow, LiveFleet } from '@/lib/data/fleet/board'
import { fromSnapshot as modelFromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
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

const box = '/home/magoz/dev/repos/box'

const liveOf = (
  sessions: ReadonlyArray<SessionRecord>,
  extra: Partial<OpenCodeSnapshot> = {},
  connectedAt = now - 60_000
): LiveFleet =>
  fromSnapshot(
    buildSnapshot(
      modelFromSnapshot(
        {
          ...emptySnapshot,
          sessions,
          projects: [
            { id: 'prj_fleet', name: 'fleet', directory: fleet },
            { id: 'prj_box', name: 'box', directory: box },
            { id: 'global', directory: '/' }
          ],
          worktrees: [{ projectID: 'prj_fleet', directories: [worktree] }],
          ...extra
        },
        connectedAt
      ),
      { connection, webUrl, now }
    )
  )

const finished = (at: number) => ({ idle: at, outcome: 'succeeded' as const })

const handled = (at: number) => ({ ...finished(at), handled: at })

const ids = (rows: ReadonlyArray<BoardRow>) => rows.map(item => item.row.id)

const sessions = [
  sessionRecord('ses_wait_short', { created: now - hour }),
  sessionRecord('ses_wait_long', { created: now - 3 * hour, directory: worktree }),
  sessionRecord('ses_run', { created: now - 2 * hour, directory: worktree }),
  sessionRecord('ses_fail', { ...finished(now - 3 * hour), outcome: 'failed' }),
  sessionRecord('ses_done_old', finished(now - 50 * hour)),
  sessionRecord('ses_done', finished(now - 4 * hour)),
  sessionRecord('ses_handled_recent', handled(now - 5 * hour)),
  sessionRecord('ses_handled_wt', { ...handled(now - 6 * hour), directory: worktree }),
  sessionRecord('ses_handled_old', handled(now - 25 * 24 * hour)),
  sessionRecord('ses_box', { ...handled(now - 10 * hour), projectID: 'prj_box', directory: box }),
  sessionRecord('ses_tmp', { ...finished(now), projectID: 'global', directory: '/tmp/scratch' })
]

const live = liveOf(sessions, {
  running: ['ses_run'],
  permissions: [
    { id: 'per_1', sessionID: 'ses_wait_short', action: 'bash', resources: ['pnpm test'] },
    { id: 'per_2', sessionID: 'ses_wait_long', action: 'edit', resources: ['README.md'] }
  ]
})

const board = buildBoard(live, now)

describe('needs me (sidebar)', () => {
  it('lists blocked rows longest wait first, then finished rows oldest first', () => {
    expect(ids(board.needsMe)).toEqual([
      'ses_wait_long',
      'ses_wait_short',
      'ses_done_old',
      'ses_done',
      'ses_fail',
      'ses_tmp'
    ])
  })

  it('counts needs me, working and stuck', () => {
    expect(board.counts).toEqual({ blocked: 2, finished: 4, working: 1, stuck: 0, handled: 4 })
  })

  it('counts a working session quiet for the threshold as stuck', () => {
    const quiet = liveOf(sessions, { running: ['ses_run'] }, now - quietAfter)

    expect(buildBoard(quiet, now).counts.stuck).toBe(1)
    expect(buildBoard(quiet, now - 1).counts.stuck).toBe(0)
  })
})

describe('projects', () => {
  it('lists every session, with no time limit, project → worktree by latest activity', () => {
    expect(
      board.projects.map(project => [
        project.name,
        project.worktrees.map(item => [item.label, ids(item.rows)])
      ])
    ).toEqual([
      [
        'fleet',
        [
          ['feat-panel', ['ses_wait_long', 'ses_run', 'ses_handled_wt']],
          [
            undefined,
            [
              'ses_wait_short',
              'ses_fail',
              'ses_done',
              'ses_done_old',
              'ses_handled_recent',
              'ses_handled_old'
            ]
          ]
        ]
      ],
      ['box', [[undefined, ['ses_box']]]],
      ['Other', [[undefined, ['ses_tmp']]]]
    ])
  })

  it("puts OpenCode's global project last as Other, even when it is the most recent", () => {
    const other = board.projects.at(-1)

    expect(other).toMatchObject({ id: 'other', name: 'Other', other: true })
    expect(board.projects.filter(project => project.other)).toHaveLength(1)
  })

  it('orders a newer project first', () => {
    const newer = buildBoard(
      liveOf([
        sessionRecord('ses_fleet', handled(now - 2 * hour)),
        sessionRecord('ses_box', { ...handled(now - hour), projectID: 'prj_box', directory: box })
      ]),
      now
    )

    expect(newer.projects.map(project => project.name)).toEqual(['box', 'fleet'])
  })
})

describe('optimistic overrides', () => {
  const done = live.rows.get('ses_done')

  if (done === undefined) throw new Error('missing ses_done')

  it('shows a row handled until the server sends anything new for it', () => {
    const optimistic = withOverrides(
      live,
      new Map([['ses_done', { base: done, target: 'handled' }]])
    )

    expect(optimistic.rows.get('ses_done')).toMatchObject({ state: 'handled', handled: done.idle })
    expect(ids(buildBoard(optimistic, now).needsMe)).not.toContain('ses_done')

    const { live: updated } = applyChange(live, {
      initial: false,
      connection,
      counts: board.counts,
      rows: [{ ...done, title: 'renamed' }],
      removed: []
    })

    expect(
      withOverrides(updated, new Map([['ses_done', { base: done, target: 'handled' }]])).rows.get(
        'ses_done'
      )?.state
    ).toBe('finished')
  })

  it('shows a reopened row finished again', () => {
    const recent = live.rows.get('ses_handled_recent')

    if (recent === undefined) throw new Error('missing ses_handled_recent')

    const reopened = withOverrides(
      live,
      new Map([['ses_handled_recent', { base: recent, target: 'finished' }]])
    ).rows.get('ses_handled_recent')

    expect(reopened?.state).toBe('finished')
    expect(reopened?.handled).toBeUndefined()
  })

  it('leaves blocked and working rows alone', () => {
    const running = live.rows.get('ses_run')

    if (running === undefined) throw new Error('missing ses_run')

    expect(
      withOverrides(live, new Map([['ses_run', { base: running, target: 'handled' }]])).rows.get(
        'ses_run'
      )?.state
    ).toBe('working')
  })
})

describe('worktree labels', () => {
  it('omits the project checkout, names worktrees and subdirectories', () => {
    expect(worktreeLabel(live, { projectID: 'prj_fleet', directory: fleet })).toBeUndefined()
    expect(worktreeLabel(live, { projectID: 'prj_fleet', directory: worktree })).toBe('feat-panel')

    const withSubdirectory = liveOf([
      sessionRecord('ses_sub', { directory: `${fleet}/packages/ui` })
    ])

    expect(
      worktreeLabel(withSubdirectory, { projectID: 'prj_fleet', directory: `${fleet}/packages/ui` })
    ).toBe('packages/ui')
  })
})

describe('row names', () => {
  it("names sessions of OpenCode's global project by their directory", () => {
    const row = live.rows.get('ses_tmp')

    if (row === undefined) throw new Error('missing ses_tmp')

    expect(boardRow(live, row)).toMatchObject({ project: 'scratch', worktree: undefined })
  })
})

describe('live changes', () => {
  it('upserts changed rows and removes deleted ones', () => {
    const running = live.rows.get('ses_run')

    if (running === undefined) throw new Error('missing ses_run')

    const changed: FleetRow = { ...running, state: 'finished', running: false }

    const { live: next, stale } = applyChange(live, {
      initial: false,
      connection: { ...connection, status: 'disconnected' },
      counts: board.counts,
      rows: [changed],
      removed: ['ses_done_old']
    })

    expect(stale).toBe(false)
    expect(next.connection.status).toBe('disconnected')
    expect(next.rows.get('ses_run')?.state).toBe('finished')
    expect(next.rows.has('ses_done_old')).toBe(false)
  })

  it('flags rows of unknown projects so the snapshot is reloaded', () => {
    const row = live.rows.get('ses_done')

    if (row === undefined) throw new Error('missing ses_done')

    const { stale } = applyChange(live, {
      initial: false,
      connection,
      counts: board.counts,
      rows: [{ ...row, id: 'ses_new', projectID: 'prj_new' }],
      removed: []
    })

    expect(stale).toBe(true)
  })
})
