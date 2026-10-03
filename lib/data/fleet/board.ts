import { countRows } from '@/lib/data/fleet/state'
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
// events, and the attention board derived from it. Pure, so it runs (and is tested) anywhere.

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

const lastSegment = (directory: string) =>
  directory.split('/').findLast(segment => segment !== '') ?? directory

/** A row with the names it is shown under: project and (non-root) worktree. */
export type BoardRow = {
  readonly row: FleetRow
  readonly project: string
  /** Worktree or subdirectory label; undefined for the project's own checkout. */
  readonly worktree: string | undefined
}

export type ActiveState = Exclude<FleetState, 'handled'>

/** Needs me (blocked, then finished), then working. */
export const activeStates: ReadonlyArray<ActiveState> = ['blocked', 'finished', 'working']

export type BoardSection = {
  readonly state: ActiveState
  readonly rows: ReadonlyArray<BoardRow>
}

export type HandledWorktree = {
  readonly label: string | undefined
  readonly rows: ReadonlyArray<BoardRow>
}

export type HandledProject = {
  readonly id: string
  readonly name: string
  readonly worktrees: ReadonlyArray<HandledWorktree>
}

export type Board = {
  /** Root rows by state (`stuck` as of `now`). */
  readonly counts: FleetCounts
  /** Active sections in order, empty ones omitted. */
  readonly sections: ReadonlyArray<BoardSection>
  /** Every handled session (no time limit), grouped project → worktree, newest first. */
  readonly handled: ReadonlyArray<HandledProject>
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

/**
 * OpenCode's `global` project (sessions outside any repository) has `/` as its directory; its
 * sessions, and those of projects the client does not know yet, are named by their directory.
 */
const namedProject = (live: LiveFleet, row: FleetRow): ProjectInfo | undefined => {
  const project = live.projects.get(row.projectID)

  return project === undefined || project.directory === '/' ? undefined : project
}

export const boardRow = (live: LiveFleet, row: FleetRow): BoardRow => {
  const project = namedProject(live, row)

  return project === undefined
    ? { row, project: lastSegment(row.directory), worktree: undefined }
    : { row, project: project.name, worktree: worktreeLabel(live, row) }
}

const newestFirst = (left: BoardRow, right: BoardRow) => right.row.activeAt - left.row.activeAt

const oldestFirst = (left: BoardRow, right: BoardRow) => left.row.activeAt - right.row.activeAt

/** Needs-me rows wait oldest first; working rows show newest first. */
const sectionOrder = (state: ActiveState) => (state === 'working' ? newestFirst : oldestFirst)

const groupHandled = (rows: ReadonlyArray<BoardRow>): ReadonlyArray<HandledProject> => {
  const projects = new Map<string, { name: string; worktrees: Map<string, Array<BoardRow>> }>()

  for (const item of rows) {
    const project = projects.get(item.row.projectID) ?? { name: item.project, worktrees: new Map() }
    const key = item.worktree ?? ''
    const worktree = project.worktrees.get(key)

    if (worktree === undefined) project.worktrees.set(key, [item])
    else worktree.push(item)

    projects.set(item.row.projectID, project)
  }

  // Rows arrive newest first, so insertion order is recency order for projects and worktrees;
  // the project's own checkout comes first, then its worktrees.
  return Array.from(projects, ([id, project]) => ({
    id,
    name: project.name,
    worktrees: Array.from(project.worktrees, ([key, worktreeRows]) => ({
      label: key === '' ? undefined : key,
      rows: worktreeRows
    })).toSorted(
      (left, right) => Number(left.label !== undefined) - Number(right.label !== undefined)
    )
  }))
}

/**
 * The attention board: blocked and finished (needs me, oldest first), working (newest first),
 * then every handled session grouped project → worktree.
 */
export const buildBoard = (live: LiveFleet, now: number): Board => {
  const rows = Array.from(live.rows.values(), row => boardRow(live, row))

  const sections = activeStates.flatMap((state): ReadonlyArray<BoardSection> => {
    const sectionRows = rows.filter(item => item.row.state === state).toSorted(sectionOrder(state))

    return sectionRows.length === 0 ? [] : [{ state, rows: sectionRows }]
  })

  return {
    counts: countRows(
      rows.map(item => item.row),
      now
    ),
    sections,
    handled: groupHandled(rows.filter(item => item.row.state === 'handled').toSorted(newestFirst))
  }
}
