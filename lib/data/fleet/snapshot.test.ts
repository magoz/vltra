import { describe, expect, it } from '@effect/vitest'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import { buildRows, buildSnapshot, snapshotRows } from '@/lib/data/fleet/snapshot'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetConnection } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connection: FleetConnection = { status: 'connected', since: baseTime, failures: 0 }

const modelOf = (snapshot: Partial<OpenCodeSnapshot>) =>
  fromSnapshot({ ...emptySnapshot, ...snapshot }, baseTime)

const build = (snapshot: Partial<OpenCodeSnapshot>) =>
  buildSnapshot(modelOf(snapshot), { connection, webUrl, now: baseTime })

const finished = { idle: baseTime + 1, outcome: 'succeeded' as const }

describe('roll-up', () => {
  const root = sessionRecord('ses_root', finished)
  const child = sessionRecord('ses_child', { parentID: 'ses_root' })
  const grandchild = sessionRecord('ses_grand', { parentID: 'ses_child' })

  it('nests descendants under one root row, depth-first', () => {
    const rows = buildRows(modelOf({ sessions: [root, child, grandchild] }), webUrl)

    expect(rows.map(row => row.id)).toEqual(['ses_root'])
    expect(rows[0]?.children.map(row => [row.id, row.depth])).toEqual([
      ['ses_child', 1],
      ['ses_grand', 2]
    ])
  })

  it('a grandchild permission makes the root and its parent blocked', () => {
    const snapshot = build({
      sessions: [root, child, grandchild],
      permissions: [{ id: 'per_1', sessionID: 'ses_grand', action: 'edit', resources: ['a.ts'] }]
    })

    const [row] = snapshotRows(snapshot)

    expect(row?.ownState).toBe('finished')
    expect(row?.state).toBe('blocked')
    expect(row?.pending).toEqual({ permissions: 1, forms: 0 })
    expect(row?.children.map(item => item.state)).toEqual(['blocked', 'blocked'])
    expect(row?.children[1]?.permissions.map(item => item.id)).toEqual(['per_1'])
  })

  it('a working child makes an otherwise handled root working', () => {
    const snapshot = build({
      sessions: [sessionRecord('ses_root'), child],
      running: ['ses_child']
    })

    expect(snapshotRows(snapshot)[0]?.state).toBe('working')
  })

  it("a subagent's finished run does not roll up; the child keeps its own state", () => {
    const snapshot = build({
      sessions: [
        sessionRecord('ses_root'),
        sessionRecord('ses_child', { parentID: 'ses_root', idle: 5, outcome: 'failed' })
      ]
    })

    const [row] = snapshotRows(snapshot)

    expect(row?.state).toBe('handled')
    expect(row?.children[0]?.state).toBe('finished')
    expect(row?.children[0]?.outcome).toBe('failed')
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
    sessionRecord('ses_a', { projectID: 'prj_fleet', directory: '/repos/fleet', created: 1 }),
    sessionRecord('ses_b', {
      projectID: 'prj_fleet',
      directory: '/repos/fleet-wt/feature',
      created: 3
    }),
    sessionRecord('ses_c', {
      projectID: 'prj_fleet',
      directory: '/repos/fleet',
      created: 2,
      ...finished
    }),
    sessionRecord('ses_d', { projectID: 'prj_box', directory: '/repos/box/sub', created: 4 })
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
          { directory: '/repos/fleet', kind: 'root', rows: ['ses_c:finished', 'ses_a:handled'] },
          { directory: '/repos/fleet-wt/feature', kind: 'worktree', rows: ['ses_b:handled'] }
        ]
      }
    ])
  })

  it('counts root rows by rolled-up state', () => {
    expect(snapshot.counts).toEqual({ blocked: 0, finished: 1, working: 1, stuck: 0, handled: 2 })
  })

  it('orders by run times, never by time.updated', () => {
    const rows = buildRows(
      modelOf({
        sessions: [
          sessionRecord('ses_old_run', { created: 1, idle: 10, handled: 10 }),
          sessionRecord('ses_new_run', { created: 2, idle: 20, handled: 20 }),
          sessionRecord('ses_never', { created: 15 })
        ]
      }),
      webUrl
    )

    expect(rows.map(row => [row.id, row.activeAt])).toEqual([
      ['ses_new_run', 20],
      ['ses_never', 15],
      ['ses_old_run', 10]
    ])
  })

  it('hides archived sessions unless they are blocked or run', () => {
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
      web: 'https://fleet.oox.sh/server/aHR0cHM6Ly9mbGVldC5vb3guc2g/session/ses_d',
      terminal: 'ocb://session/ses_d',
      command: 'ocb -s ses_d'
    })
  })
})

describe('handled marker, interrupt reason and live facts on rows', () => {
  it('exposes the handled marker, outcome and interrupt reason', () => {
    const model = modelOf({
      sessions: [sessionRecord('ses_1', { idle: 10, outcome: 'interrupted', handled: 5 })]
    })

    const session = model.sessions.get('ses_1')

    const withReason =
      session === undefined
        ? model
        : {
            ...model,
            sessions: new Map(model.sessions).set('ses_1', { ...session, interrupt: 'inactivity' })
          }

    expect(buildRows(withReason, webUrl)[0]).toMatchObject({
      state: 'finished',
      idle: 10,
      handled: 5,
      outcome: 'interrupted',
      interrupt: 'inactivity'
    })
  })

  it('running rows are active since the connection after a snapshot', () => {
    const rows = buildRows(
      modelOf({ sessions: [sessionRecord('ses_run')], running: ['ses_run'] }),
      webUrl
    )

    expect(rows[0]).toMatchObject({ running: true, activityAt: baseTime, activeAt: baseTime })
  })

  it('shows activity only while the session runs', () => {
    const model = modelOf({
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
