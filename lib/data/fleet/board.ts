import { compareStates, countRows } from '@/lib/data/fleet/state'
import type {
  FleetChange,
  FleetConnection,
  FleetCounts,
  FleetRow,
  FleetSnapshot,
  WorktreeKind
} from '@/lib/data/fleet/types'

// The dashboard's client-side view of the fleet: a flat row map kept live from `fleet.changed`
// events, and the two areas derived from it (DESIGN.md "Clients"): the needs-me sidebar and
// Projects. Pure, so it runs (and is tested) anywhere.

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

/**
 * An optimistic Handled / Undo / Reopen: show `row` as `target` until the server sends anything
 * new for it (a different row object), then trust the server again.
 */
export type RowOverride = {
  readonly base: FleetRow
  readonly target: 'handled' | 'finished'
}

const overridden = (row: FleetRow, target: RowOverride['target']): FleetRow => {
  if (target === 'handled') {
    return row.state === 'finished'
      ? { ...row, state: 'handled', ownState: 'handled', handled: row.idle }
      : row
  }

  if (row.state !== 'handled' || row.idle === undefined) return row

  const { handled: _handled, ...rest } = row

  return { ...rest, state: 'finished', ownState: 'finished' }
}

/** The live fleet with pending optimistic overrides applied (only to unchanged rows). */
export const withOverrides = (
  live: LiveFleet,
  overrides: ReadonlyMap<string, RowOverride>
): LiveFleet => {
  const active = Array.from(overrides).filter(
    ([id, override]) => live.rows.get(id) === override.base
  )

  if (active.length === 0) return live

  const rows = new Map(live.rows)

  for (const [id, override] of active) rows.set(id, overridden(override.base, override.target))

  return { ...live, rows }
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

/** OpenCode's `global` project (sessions outside any repository) has `/` as its directory. */
const isOtherProject = (live: LiveFleet, row: Pick<FleetRow, 'projectID'>): boolean =>
  live.projects.get(row.projectID)?.directory === '/'

/**
 * Sessions of the global project, and of projects the client does not know yet, are named by
 * their directory.
 */
export const boardRow = (live: LiveFleet, row: FleetRow): BoardRow => {
  const project = live.projects.get(row.projectID)

  return project === undefined || isOtherProject(live, row)
    ? { row, project: lastSegment(row.directory), worktree: undefined }
    : { row, project: project.name, worktree: worktreeLabel(live, row) }
}

export type ProjectWorktree = {
  readonly directory: string
  /** Undefined for the project's own checkout. */
  readonly label: string | undefined
  readonly rows: ReadonlyArray<BoardRow>
}

export type ProjectGroup = {
  readonly id: string
  readonly name: string
  /** The "Other" group: every session outside a repository, each row showing its directory. */
  readonly other: boolean
  readonly worktrees: ReadonlyArray<ProjectWorktree>
}

export type Board = {
  /** Root rows by state (`stuck` as of `now`). */
  readonly counts: FleetCounts
  /**
   * The sidebar: blocked rows (longest wait first), then finished rows (oldest first). A blocked
   * run stopped moving when it asked, so its `activeAt` is when the wait began.
   */
  readonly needsMe: ReadonlyArray<BoardRow>
  /** Every root session, project → worktree by latest activity; "Other" last. */
  readonly projects: ReadonlyArray<ProjectGroup>
}

const otherProjectID = 'other'

const oldestFirst = (left: BoardRow, right: BoardRow) => left.row.activeAt - right.row.activeAt

/**
 * In a worktree: needs-me and working sessions first (blocked, working, finished), then handled
 * ones; newest first within each.
 */
const worktreeOrder = (left: BoardRow, right: BoardRow) =>
  compareStates(left.row.state, right.row.state) || right.row.activeAt - left.row.activeAt

const latest = (rows: ReadonlyArray<BoardRow>) =>
  Math.max(0, ...rows.map(item => item.row.activeAt))

const groupBy = <A>(values: ReadonlyArray<A>, key: (value: A) => string) => {
  const groups = new Map<string, Array<A>>()

  for (const value of values) {
    const group = groups.get(key(value))

    if (group === undefined) groups.set(key(value), [value])
    else group.push(value)
  }

  return groups
}

const byLatest = (left: ProjectWorktree, right: ProjectWorktree) =>
  latest(right.rows) - latest(left.rows)

const projectLatest = (group: ProjectGroup) =>
  Math.max(0, ...group.worktrees.map(worktree => latest(worktree.rows)))

const projectGroup = (live: LiveFleet, id: string, rows: ReadonlyArray<BoardRow>): ProjectGroup => {
  const worktrees = Array.from(
    groupBy(rows, item => item.row.directory),
    ([directory, items]) => ({
      directory,
      label: items[0]?.worktree,
      rows: items.toSorted(worktreeOrder)
    })
  ).toSorted(byLatest)

  return {
    id,
    name: live.projects.get(id)?.name ?? rows[0]?.project ?? id,
    other: false,
    worktrees
  }
}

const groupProjects = (
  live: LiveFleet,
  rows: ReadonlyArray<BoardRow>
): ReadonlyArray<ProjectGroup> => {
  const other = rows.filter(item => isOtherProject(live, item.row))

  const named = Array.from(
    groupBy(
      rows.filter(item => !isOtherProject(live, item.row)),
      item => item.row.projectID
    ),
    ([id, items]) => projectGroup(live, id, items)
  ).toSorted(
    (left, right) =>
      projectLatest(right) - projectLatest(left) || left.name.localeCompare(right.name)
  )

  if (other.length === 0) return named

  return [
    ...named,
    {
      id: otherProjectID,
      name: 'Other',
      other: true,
      worktrees: [{ directory: '/', label: undefined, rows: other.toSorted(worktreeOrder) }]
    }
  ]
}

/** The sidebar (needs me) and Projects (every session), with counts as of `now`. */
export const buildBoard = (live: LiveFleet, now: number): Board => {
  const rows = Array.from(live.rows.values(), row => boardRow(live, row))
  const inState = (state: FleetRow['state']) => rows.filter(item => item.row.state === state)

  return {
    counts: countRows(
      rows.map(item => item.row),
      now
    ),
    needsMe: [
      ...inState('blocked').toSorted(oldestFirst),
      ...inState('finished').toSorted(oldestFirst)
    ],
    projects: groupProjects(live, rows)
  }
}
