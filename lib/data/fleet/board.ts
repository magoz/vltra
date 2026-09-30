import { compareStates } from '@/lib/data/fleet/state'
import type {
  FleetChange,
  FleetConnection,
  FleetCounts,
  FleetRow,
  FleetSnapshot,
  FleetState,
  WorktreeKind
} from '@/lib/data/fleet/types'

// The dashboard's client-side view of the fleet: a flat row map kept live from `fleet.changed`
// events, and the state-first board derived from it. Pure, so it runs (and is tested) anywhere.

export type ProjectInfo = { readonly name: string; readonly directory: string }

export type LiveFleet = {
  readonly connection: FleetConnection
  readonly rows: ReadonlyMap<string, FleetRow>
  readonly projects: ReadonlyMap<string, ProjectInfo>
  /** Worktree kind by directory, as last reported by a snapshot. */
  readonly worktrees: ReadonlyMap<string, WorktreeKind>
}

export const fromSnapshot = (snapshot: FleetSnapshot): LiveFleet => ({
  connection: snapshot.connection,
  rows: new Map(
    snapshot.projects.flatMap(project =>
      project.worktrees.flatMap(worktree => worktree.rows.map(row => [row.id, row] as const))
    )
  ),
  projects: new Map(
    snapshot.projects.map(
      project => [project.id, { name: project.name, directory: project.directory }] as const
    )
  ),
  worktrees: new Map(
    snapshot.projects.flatMap(project =>
      project.worktrees.map(worktree => [worktree.directory, worktree.kind] as const)
    )
  )
})

export type AppliedChange = { readonly live: LiveFleet; readonly stale: boolean }

/**
 * Applies one `fleet.changed` event. `stale` is true when a row belongs to a project the client
 * has not seen (its name is only in a snapshot), so the caller should reload the snapshot.
 */
export const applyChange = (live: LiveFleet, change: FleetChange): AppliedChange => {
  const rows = new Map(live.rows)

  for (const id of change.removed) rows.delete(id)

  for (const row of change.rows) rows.set(row.id, row)

  return {
    live: { ...live, connection: change.connection, rows },
    stale: change.rows.some(row => !live.projects.has(row.projectID))
  }
}

/** Idle (seen) sessions stay listed this long after their last activity. */
export const idleWindow = 24 * 60 * 60 * 1000

/** A row's last activity: its last update or the end of its last run. */
export const lastActivity = (row: FleetRow) => Math.max(row.updated, row.idle ?? 0)

const lastSegment = (directory: string) =>
  directory.split('/').findLast(segment => segment !== '') ?? directory

/** A row with the names it is shown under: project and (non-root) worktree. */
export type BoardRow = {
  readonly row: FleetRow
  readonly project: string
  /** Worktree or subdirectory label; undefined for the project's own checkout. */
  readonly worktree: string | undefined
}

export type ActiveState = Exclude<FleetState, 'idle'>

export const activeStates: ReadonlyArray<ActiveState> = ['needs-you', 'failed', 'working', 'done']

export type BoardSection = {
  readonly state: ActiveState
  readonly rows: ReadonlyArray<BoardRow>
}

export type IdleWorktree = {
  readonly label: string | undefined
  readonly rows: ReadonlyArray<BoardRow>
}

export type IdleProject = {
  readonly id: string
  readonly name: string
  readonly worktrees: ReadonlyArray<IdleWorktree>
}

export type Board = {
  /** Counts of what the board lists (idle: within the window, or all with `showOlder`). */
  readonly counts: FleetCounts
  /** Active sections in priority order, empty ones omitted. */
  readonly sections: ReadonlyArray<BoardSection>
  readonly idle: ReadonlyArray<IdleProject>
  /** Idle sessions hidden because their last activity is older than the window. */
  readonly olderIdle: number
}

export const worktreeLabel = (
  live: LiveFleet,
  row: Pick<FleetRow, 'projectID' | 'directory'>
): string | undefined => {
  const project = live.projects.get(row.projectID)
  const kind = live.worktrees.get(row.directory)

  if (kind === 'root' || row.directory === project?.directory) return undefined

  if (kind === 'directory' && project !== undefined) {
    const prefix = project.directory.endsWith('/') ? project.directory : `${project.directory}/`

    if (row.directory.startsWith(prefix)) return row.directory.slice(prefix.length)
  }

  return lastSegment(row.directory)
}

export const boardRow = (live: LiveFleet, row: FleetRow): BoardRow => ({
  row,
  project: live.projects.get(row.projectID)?.name ?? lastSegment(row.directory),
  worktree: worktreeLabel(live, row)
})

const byRecency = (left: BoardRow, right: BoardRow) =>
  lastActivity(right.row) - lastActivity(left.row)

const groupIdle = (rows: ReadonlyArray<BoardRow>): ReadonlyArray<IdleProject> => {
  const projects = new Map<string, { name: string; worktrees: Map<string, Array<BoardRow>> }>()

  for (const item of rows) {
    const project = projects.get(item.row.projectID) ?? { name: item.project, worktrees: new Map() }
    const key = item.worktree ?? ''
    const worktree = project.worktrees.get(key)

    if (worktree === undefined) project.worktrees.set(key, [item])
    else worktree.push(item)

    projects.set(item.row.projectID, project)
  }

  // Rows arrive newest first, so insertion order is recency order for projects and worktrees.
  return Array.from(projects, ([id, project]) => ({
    id,
    name: project.name,
    worktrees: Array.from(project.worktrees, ([key, worktreeRows]) => ({
      label: key === '' ? undefined : key,
      rows: worktreeRows
    }))
  }))
}

/**
 * The state-first board: needs you, failed, working, done (each newest first), then idle
 * sessions grouped project → worktree. Idle sessions older than `idleWindow` are hidden unless
 * `showOlder`.
 */
export const buildBoard = (live: LiveFleet, now: number, showOlder: boolean): Board => {
  const rows = Array.from(live.rows.values(), row => boardRow(live, row)).toSorted(
    (left, right) => compareStates(left.row.state, right.row.state) || byRecency(left, right)
  )

  const idle = rows.filter(item => item.row.state === 'idle')
  const recentIdle = idle.filter(item => lastActivity(item.row) >= now - idleWindow)
  const listedIdle = showOlder ? idle : recentIdle

  const sections = activeStates.flatMap((state): ReadonlyArray<BoardSection> => {
    const sectionRows = rows.filter(item => item.row.state === state)

    return sectionRows.length === 0 ? [] : [{ state, rows: sectionRows }]
  })

  const count = (state: ActiveState) =>
    sections.find(section => section.state === state)?.rows.length ?? 0

  return {
    counts: {
      'needs-you': count('needs-you'),
      failed: count('failed'),
      working: count('working'),
      done: count('done'),
      idle: listedIdle.length
    },
    sections,
    idle: groupIdle(listedIdle),
    olderIdle: idle.length - recentIdle.length
  }
}
