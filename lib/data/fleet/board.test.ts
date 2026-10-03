import { describe, expect, it } from '@effect/vitest'
import {
  applyChange,
  boardColumns,
  boardRow,
  buildAgentsBoard,
  buildNeedsMe,
  buildProjectCards,
  fromSnapshot,
  handledWindow,
  initialColumn,
  needsMeOrder,
  nextNeedsMe,
  otherProjectID,
  projectName,
  withOverrides,
  worktreeLabel
} from '@/lib/data/fleet/board'
import type { AgentsBoard, BoardRow, LiveFleet } from '@/lib/data/fleet/board'
import { fromSnapshot as modelFromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import { buildSnapshot } from '@/lib/data/fleet/snapshot'
import { countRows, quietAfter } from '@/lib/data/fleet/state'
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

const board = buildAgentsBoard(live, now, undefined)

const columnIDs = (agents: AgentsBoard) =>
  Object.fromEntries(boardColumns.map(column => [column, ids(agents.columns[column])]))

describe('agents board', () => {
  it('puts every root session in its state column, in column order', () => {
    expect(columnIDs(board)).toEqual({
      blocked: ['ses_wait_long', 'ses_wait_short'],
      finished: ['ses_done_old', 'ses_done', 'ses_fail', 'ses_tmp'],
      working: ['ses_run'],
      handled: ['ses_handled_recent', 'ses_handled_wt', 'ses_box']
    })
  })

  it('shows handled sessions active in the last 24h, newest first, and counts the rest', () => {
    const agents = buildAgentsBoard(
      liveOf([
        sessionRecord('ses_edge', handled(now - handledWindow)),
        sessionRecord('ses_past', handled(now - handledWindow - 1)),
        sessionRecord('ses_new', handled(now - hour)),
        sessionRecord('ses_ancient', handled(now - 90 * 24 * hour))
      ]),
      now,
      undefined
    )

    expect(ids(agents.columns.handled)).toEqual(['ses_new', 'ses_edge'])
    expect(agents.olderHandled).toBe(2)
  })

  it('puts stuck working sessions first, then the newest session first', () => {
    const running = liveOf(
      [
        sessionRecord('ses_old', { created: now - 3 * hour }),
        sessionRecord('ses_new', { created: now - hour }),
        sessionRecord('ses_oldest', { created: now - 5 * hour })
      ],
      { running: ['ses_old', 'ses_new', 'ses_oldest'] }
    )

    expect(ids(buildAgentsBoard(running, now, undefined).columns.working)).toEqual([
      'ses_new',
      'ses_old',
      'ses_oldest'
    ])

    const oldest = running.rows.get('ses_oldest')

    if (oldest === undefined) throw new Error('missing ses_oldest')

    const retrying: LiveFleet = {
      ...running,
      rows: new Map(running.rows).set('ses_oldest', {
        ...oldest,
        retry: { attempt: 2, at: now, message: 'rate limited' }
      })
    }

    expect(ids(buildAgentsBoard(retrying, now, undefined).columns.working)).toEqual([
      'ses_oldest',
      'ses_new',
      'ses_old'
    ])
  })

  it('narrows every column, and the older-handled count, to one project', () => {
    const fleetOnly = buildAgentsBoard(live, now, 'prj_fleet')

    expect(columnIDs(fleetOnly)).toEqual({
      blocked: ['ses_wait_long', 'ses_wait_short'],
      finished: ['ses_done_old', 'ses_done', 'ses_fail'],
      working: ['ses_run'],
      handled: ['ses_handled_recent', 'ses_handled_wt']
    })
    expect(fleetOnly.olderHandled).toBe(1)
    expect(columnIDs(buildAgentsBoard(live, now, 'prj_box'))).toMatchObject({
      finished: [],
      handled: ['ses_box']
    })
    expect(buildAgentsBoard(live, now, 'prj_box').olderHandled).toBe(0)
  })

  it("files OpenCode's global project under Other", () => {
    expect(columnIDs(buildAgentsBoard(live, now, otherProjectID))).toEqual({
      blocked: [],
      finished: ['ses_tmp'],
      working: [],
      handled: []
    })
    expect(columnIDs(buildAgentsBoard(live, now, 'global')).finished).toEqual([])
    expect(projectName(live, otherProjectID)).toBe('Other')
    expect(projectName(live, 'prj_box')).toBe('box')
  })

  it('opens the phone on the first needs-me column with cards, else Working', () => {
    expect(initialColumn(board)).toBe('blocked')
    expect(initialColumn(buildAgentsBoard(live, now, 'prj_box'))).toBe('working')
    expect(initialColumn(buildAgentsBoard(live, now, otherProjectID))).toBe('finished')
  })
})

describe('needs me (focus mode)', () => {
  it('lists blocked (longest wait first), then finished (oldest first), nothing else', () => {
    const needsMe = buildNeedsMe(live, undefined)

    expect(ids(needsMe.blocked)).toEqual(['ses_wait_long', 'ses_wait_short'])
    expect(ids(needsMe.finished)).toEqual(['ses_done_old', 'ses_done', 'ses_fail', 'ses_tmp'])
    expect(ids(needsMeOrder(needsMe))).toEqual([
      'ses_wait_long',
      'ses_wait_short',
      'ses_done_old',
      'ses_done',
      'ses_fail',
      'ses_tmp'
    ])
    // The board's two left columns are the same list.
    expect(board.columns.blocked).toEqual(needsMe.blocked)
    expect(board.columns.finished).toEqual(needsMe.finished)
  })

  it('narrows to one project', () => {
    expect(ids(needsMeOrder(buildNeedsMe(live, 'prj_fleet')))).toEqual([
      'ses_wait_long',
      'ses_wait_short',
      'ses_done_old',
      'ses_done',
      'ses_fail'
    ])
    expect(ids(needsMeOrder(buildNeedsMe(live, otherProjectID)))).toEqual(['ses_tmp'])
    expect(ids(needsMeOrder(buildNeedsMe(live, 'prj_box')))).toEqual([])
  })

  it('opens the next session after a handled one, else the one before, else nothing', () => {
    const list = needsMeOrder(buildNeedsMe(live, undefined))
    const next = (id: string, from = list) => nextNeedsMe(from, id)?.row.id

    expect(next('ses_done_old')).toBe('ses_done')
    expect(next('ses_done')).toBe('ses_fail')
    // From the last blocked session on to the first finished one.
    expect(next('ses_wait_short')).toBe('ses_done_old')
    // The last one: the one before it.
    expect(next('ses_tmp')).toBe('ses_fail')
    // Not in the list (opened from elsewhere): the first.
    expect(next('ses_run')).toBe('ses_wait_long')

    const only = list.filter(item => item.row.id === 'ses_tmp')

    expect(next('ses_tmp', only)).toBeUndefined()
    expect(next('ses_run', [])).toBeUndefined()
  })
})

describe('counts', () => {
  const rowsOf = (fleet: LiveFleet) => Array.from(fleet.rows.values())

  it('counts needs me, working and stuck', () => {
    expect(countRows(rowsOf(live), now)).toEqual({
      blocked: 2,
      finished: 4,
      working: 1,
      stuck: 0,
      handled: 4
    })
  })

  it('counts a working session quiet for the threshold as stuck', () => {
    const quiet = liveOf(sessions, { running: ['ses_run'] }, now - quietAfter)

    expect(countRows(rowsOf(quiet), now).stuck).toBe(1)
    expect(countRows(rowsOf(quiet), now - 1).stuck).toBe(0)
  })
})

describe('project cards', () => {
  const cards = buildProjectCards(live)

  it('groups every session, no time limit, by project; worktrees list needs-me and working', () => {
    expect(
      cards.map(card => ({
        name: card.name,
        needMe: card.needMe,
        working: card.working,
        sections: card.sections.map(section => [section.name, ids(section.rows)]),
        handled: ids(card.handled)
      }))
    ).toEqual([
      {
        name: 'fleet',
        needMe: 5,
        working: 1,
        sections: [
          ['feat-panel', ['ses_wait_long', 'ses_run']],
          ['fleet', ['ses_wait_short', 'ses_fail', 'ses_done', 'ses_done_old']]
        ],
        handled: ['ses_handled_recent', 'ses_handled_wt', 'ses_handled_old']
      },
      { name: 'box', needMe: 0, working: 0, sections: [], handled: ['ses_box'] },
      { name: 'Other', needMe: 1, working: 0, sections: [['Other', ['ses_tmp']]], handled: [] }
    ])
  })

  it("puts OpenCode's global project last as Other, even when it is the most recent", () => {
    expect(cards.at(-1)).toMatchObject({ id: otherProjectID, name: 'Other', other: true })
    expect(cards.filter(card => card.other)).toHaveLength(1)
  })

  it('orders cards by latest activity, handled sessions included', () => {
    const newer = buildProjectCards(
      liveOf([
        sessionRecord('ses_fleet', handled(now - 2 * hour)),
        sessionRecord('ses_box', { ...handled(now - hour), projectID: 'prj_box', directory: box }),
        sessionRecord('ses_tmp', { ...handled(now), projectID: 'global', directory: '/tmp/x' })
      ])
    )

    expect(newer.map(card => [card.id, card.name])).toEqual([
      ['prj_box', 'box'],
      ['prj_fleet', 'fleet'],
      [otherProjectID, 'Other']
    ])
  })

  it('folds handled sessions newest first, with no time limit', () => {
    const fold = cards[0]?.handled ?? []

    expect(fold.map(item => [item.row.id, item.worktree])).toEqual([
      ['ses_handled_recent', undefined],
      ['ses_handled_wt', 'feat-panel'],
      ['ses_handled_old', undefined]
    ])
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
    expect(ids(buildAgentsBoard(optimistic, now, undefined).columns.finished)).not.toContain(
      'ses_done'
    )
    expect(ids(buildAgentsBoard(optimistic, now, undefined).columns.handled)).toContain('ses_done')

    const { live: updated } = applyChange(live, {
      initial: false,
      connection,
      counts: countRows(Array.from(live.rows.values()), now),
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
      counts: countRows(Array.from(live.rows.values()), now),
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
      counts: countRows(Array.from(live.rows.values()), now),
      rows: [{ ...row, id: 'ses_new', projectID: 'prj_new' }],
      removed: []
    })

    expect(stale).toBe(true)
  })
})
