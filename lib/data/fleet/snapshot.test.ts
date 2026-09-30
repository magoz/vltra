import { describe, expect, it } from '@effect/vitest'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import { buildRows, buildSnapshot, snapshotRows } from '@/lib/data/fleet/snapshot'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetConnection } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connection: FleetConnection = { status: 'connected', since: baseTime, failures: 0 }

const build = (snapshot: Partial<OpenCodeSnapshot>) =>
  buildSnapshot(fromSnapshot({ ...emptySnapshot, ...snapshot }), {
    connection,
    webUrl,
    now: baseTime
  })

const finished = { idle: baseTime + 1, outcome: 'succeeded' as const }

describe('roll-up', () => {
  const root = sessionRecord('ses_root', finished)
  const child = sessionRecord('ses_child', { parentID: 'ses_root' })
  const grandchild = sessionRecord('ses_grand', { parentID: 'ses_child' })

  it('nests descendants under one root row, depth-first', () => {
    const rows = buildRows(
      fromSnapshot({ ...emptySnapshot, sessions: [root, child, grandchild] }),
      webUrl
    )

    expect(rows.map(row => row.id)).toEqual(['ses_root'])
    expect(rows[0]?.children.map(row => [row.id, row.depth])).toEqual([
      ['ses_child', 1],
      ['ses_grand', 2]
    ])
  })

  it('a grandchild permission makes the root and its parent needs-you', () => {
    const snapshot = build({
      sessions: [root, child, grandchild],
      permissions: [{ id: 'per_1', sessionID: 'ses_grand', action: 'edit', resources: ['a.ts'] }]
    })

    const [row] = snapshotRows(snapshot)

    expect(row?.ownState).toBe('done')
    expect(row?.state).toBe('needs-you')
    expect(row?.pending).toEqual({ permissions: 1, forms: 0 })
    expect(row?.children.map(item => item.state)).toEqual(['needs-you', 'needs-you'])
    expect(row?.children[1]?.permissions.map(item => item.id)).toEqual(['per_1'])
  })

  it('a working child makes an otherwise idle root working', () => {
    const snapshot = build({
      sessions: [sessionRecord('ses_root'), child],
      running: ['ses_child']
    })

    expect(snapshotRows(snapshot)[0]?.state).toBe('working')
  })

  it('failed and done children do not roll up', () => {
    const snapshot = build({
      sessions: [
        sessionRecord('ses_root'),
        sessionRecord('ses_child', { parentID: 'ses_root', idle: 5, outcome: 'failed' })
      ]
    })

    const [row] = snapshotRows(snapshot)

    expect(row?.state).toBe('idle')
    expect(row?.children[0]?.state).toBe('failed')
  })

  it('children of unknown parents become roots', () => {
    const snapshot = build({ sessions: [sessionRecord('ses_orphan', { parentID: 'ses_gone' })] })

    expect(snapshotRows(snapshot).map(row => row.id)).toEqual(['ses_orphan'])
  })
})

describe('grouping and ordering', () => {
  const projects = [
    { id: 'prj_fleet', name: 'fleet', directory: '/repos/fleet' },
    { id: 'prj_box', directory: '/repos/box' }
  ]

  const sessions = [
    sessionRecord('ses_a', { projectID: 'prj_fleet', directory: '/repos/fleet', updated: 1 }),
    sessionRecord('ses_b', {
      projectID: 'prj_fleet',
      directory: '/repos/fleet-wt/feature',
      updated: 3
    }),
    sessionRecord('ses_c', {
      projectID: 'prj_fleet',
      directory: '/repos/fleet',
      updated: 2,
      ...finished
    }),
    sessionRecord('ses_d', { projectID: 'prj_box', directory: '/repos/box/sub', updated: 4 })
  ]

  const snapshot = build({
    sessions,
    projects,
    running: ['ses_d'],
    worktrees: [{ projectID: 'prj_fleet', directories: ['/repos/fleet-wt/feature'] }]
  })

  it('groups projects → worktrees → rows and orders by state then recency', () => {
    expect(
      snapshot.projects.map(project => ({
        name: project.name,
        worktrees: project.worktrees.map(worktree => ({
          directory: worktree.directory,
          kind: worktree.kind,
          rows: worktree.rows.map(row => `${row.id}:${row.state}`)
        }))
      }))
    ).toEqual([
      {
        name: 'box',
        worktrees: [{ directory: '/repos/box/sub', kind: 'directory', rows: ['ses_d:working'] }]
      },
      {
        name: 'fleet',
        worktrees: [
          { directory: '/repos/fleet', kind: 'root', rows: ['ses_c:done', 'ses_a:idle'] },
          { directory: '/repos/fleet-wt/feature', kind: 'worktree', rows: ['ses_b:idle'] }
        ]
      }
    ])
  })

  it('counts root rows by rolled-up state', () => {
    expect(snapshot.counts).toEqual({ 'needs-you': 0, failed: 0, working: 1, done: 1, idle: 2 })
  })

  it('hides archived sessions unless they need attention or run', () => {
    const archived = build({
      sessions: [
        sessionRecord('ses_old', { archived: 5 }),
        sessionRecord('ses_busy', { archived: 5 })
      ],
      running: ['ses_busy']
    })

    expect(snapshotRows(archived).map(row => row.id)).toEqual(['ses_busy'])
  })

  it('adds deep links to every row', () => {
    const row = snapshotRows(snapshot)[0]

    expect(row?.links).toEqual({
      web: 'https://box.tail129a86.ts.net:9446/server/aHR0cHM6Ly9ib3gudGFpbDEyOWE4Ni50cy5uZXQ6OTQ0Ng/session/ses_d',
      terminal: 'ocb://session/ses_d',
      command: 'ocb -s ses_d'
    })
  })
})

describe('live activity on rows', () => {
  it('shows activity only while the session runs', () => {
    const model = fromSnapshot({
      ...emptySnapshot,
      sessions: [sessionRecord('ses_run'), sessionRecord('ses_stopped')],
      running: ['ses_run']
    })

    const activity = { kind: 'tool' as const, tool: 'bash', detail: 'pnpm build' }

    const withActivity = {
      ...model,
      sessions: new Map(
        Array.from(model.sessions, ([key, session]) => [
          key,
          { ...session, activity, activityCall: 'call_1' }
        ])
      )
    }

    const rows = buildRows(withActivity, webUrl)

    expect(rows.find(row => row.id === 'ses_run')?.activity).toEqual(activity)
    expect(rows.find(row => row.id === 'ses_stopped')?.activity).toBeUndefined()
  })
})
