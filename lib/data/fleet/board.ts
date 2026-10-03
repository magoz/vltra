import { isWithin } from '@/lib/data/fleet/checkouts'
import { worktreeName } from '@/lib/data/fleet/palette'
import { compareStates, isStuck } from '@/lib/data/fleet/state'
import type {
  FleetChange,
  FleetConnection,
  FleetRow,
  FleetSnapshot,
  FleetState,
  Launch,
  LauncherEntry,
  LauncherWorktree,
  WorktreeKind
} from '@/lib/data/fleet/types'

// The dashboard's client-side view of the fleet: a flat row map kept live from `fleet.changed`
// events, and the two pages derived from it (DESIGN.md "Clients"): the Agents page (its focus
// mode's needs-me list, its board's columns by state) and the Projects grid (one card per
// project). Pure, so it runs (and is tested) anywhere.

export type ProjectInfo = { readonly name: string; readonly directory: string }

export type LiveFleet = {
  readonly connection: FleetConnection
  readonly rows: ReadonlyMap<string, FleetRow>
  readonly projects: ReadonlyMap<string, ProjectInfo>
  /** Worktree kind by directory, as last reported by a snapshot. */
  readonly worktrees: ReadonlyMap<string, WorktreeKind>
  /** The launcher's launches (provisioning, failed, recently ready), oldest first. */
  readonly launches: ReadonlyArray<Launch>
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
  ),
  launches: snapshot.launches
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
    live: {
      ...live,
      connection: change.connection,
      rows,
      launches: change.launches ?? live.launches
    },
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
export const isOtherProject = (live: LiveFleet, row: Pick<FleetRow, 'projectID'>): boolean =>
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

/** The "Other" project's id in the grid and in `?project=`: every session outside a repository. */
export const otherProjectID = 'other'

/** The project a row is filed under: its own, or "Other" for sessions outside a repository. */
export const projectKey = (live: LiveFleet, row: Pick<FleetRow, 'projectID'>): string =>
  isOtherProject(live, row) ? otherProjectID : row.projectID

/** A `projectKey`'s display name, also for a project with no sessions left. */
export const projectName = (live: LiveFleet, id: string): string =>
  id === otherProjectID ? 'Other' : (live.projects.get(id)?.name ?? id)

const hour = 60 * 60 * 1000

/** The Agents board's Handled column shows sessions active within this window. */
export const handledWindow = 24 * hour

/** The Agents board's columns, left to right; the first two need me. */
export const boardColumns = ['blocked', 'finished', 'working', 'handled'] as const

export type BoardColumn = (typeof boardColumns)[number]

export type AgentsBoard = {
  readonly columns: Readonly<Record<BoardColumn, ReadonlyArray<BoardRow>>>
  /** Handled sessions older than `handledWindow` (not on the board): "N more → Projects". */
  readonly olderHandled: number
}

const oldestFirst = (left: BoardRow, right: BoardRow) => left.row.activeAt - right.row.activeAt

const newestFirst = (left: BoardRow, right: BoardRow) => right.row.activeAt - left.row.activeAt

const allRows = (live: LiveFleet) => Array.from(live.rows.values(), row => boardRow(live, row))

const projectRows = (live: LiveFleet, project: string | undefined) =>
  allRows(live).filter(item => project === undefined || projectKey(live, item.row) === project)

/** The sessions that need me: the board's two left columns, and focus mode's list. */
export type NeedsMe = {
  readonly blocked: ReadonlyArray<BoardRow>
  readonly finished: ReadonlyArray<BoardRow>
}

const needsMeOf = (rows: ReadonlyArray<BoardRow>): NeedsMe => ({
  blocked: rows.filter(item => item.row.state === 'blocked').toSorted(oldestFirst),
  finished: rows.filter(item => item.row.state === 'finished').toSorted(oldestFirst)
})

/**
 * The needs-me sessions, narrowed to `project` (a `projectKey`) when given: blocked, longest wait
 * first (a blocked run stopped moving when it asked, so its `activeAt` is when the wait began);
 * finished, oldest first.
 */
export const buildNeedsMe = (live: LiveFleet, project: string | undefined): NeedsMe =>
  needsMeOf(projectRows(live, project))

/** Focus mode's list order: blocked, then finished. */
export const needsMeOrder = (needsMe: NeedsMe): ReadonlyArray<BoardRow> => [
  ...needsMe.blocked,
  ...needsMe.finished
]

/**
 * The session focus mode opens once `id` is handled, from `list` (the needs-me order as it was
 * before handling): the one after it, else the one before it (it was last); the first when `id`
 * was not listed (opened from elsewhere). Undefined when nothing else is left.
 */
export const nextNeedsMe = (list: ReadonlyArray<BoardRow>, id: string): BoardRow | undefined => {
  const index = list.findIndex(item => item.row.id === id)

  if (index < 0) return list[0]

  return list[index + 1] ?? list[index - 1]
}

/**
 * The Agents board as of `now`, narrowed to `project` (a `projectKey`) when given:
 * - blocked and finished: `buildNeedsMe`;
 * - working: stuck first, then the newest session first (`created`, which never moves, so live
 *   activity does not reshuffle the column);
 * - handled: active within `handledWindow`, newest first; the rest only counted.
 */
export const buildAgentsBoard = (
  live: LiveFleet,
  now: number,
  project: string | undefined
): AgentsBoard => {
  const rows = projectRows(live, project)
  const inState = (state: FleetState) => rows.filter(item => item.row.state === state)
  const handled = inState('handled')
  const recent = handled.filter(item => now - item.row.activeAt <= handledWindow)

  return {
    columns: {
      ...needsMeOf(rows),
      working: inState('working').toSorted(
        (left, right) =>
          Number(isStuck(right.row, now)) - Number(isStuck(left.row, now)) ||
          right.row.created - left.row.created
      ),
      handled: recent.toSorted(newestFirst)
    },
    olderHandled: handled.length - recent.length
  }
}

/** The phone shows one column: the first needs-me column with cards, else Working. */
export const initialColumn = (board: AgentsBoard): BoardColumn => {
  if (board.columns.blocked.length > 0) return 'blocked'

  if (board.columns.finished.length > 0) return 'finished'

  return 'working'
}

/** A worktree section of a project card: its needs-me and working sessions. */
export type CardSection = {
  readonly directory: string
  /** The worktree's name: its label, or the checkout's folder name. */
  readonly name: string
  readonly rows: ReadonlyArray<BoardRow>
}

export type ProjectCard = {
  /** The project's id, or `otherProjectID`; `?project=` takes it. */
  readonly id: string
  readonly name: string
  /** The "Other" card: every session outside a repository, each row showing its directory. */
  readonly other: boolean
  readonly needMe: number
  readonly working: number
  /** Worktrees by latest activity; only those with needs-me or working sessions. */
  readonly sections: ReadonlyArray<CardSection>
  /** Handled sessions, newest first: the "N handled · last 2h" fold. */
  readonly handled: ReadonlyArray<BoardRow>
}

/** In a section: blocked, working, then finished; newest first within each. */
const sectionOrder = (left: BoardRow, right: BoardRow) =>
  compareStates(left.row.state, right.row.state) || newestFirst(left, right)

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

const projectCard = (
  live: LiveFleet,
  id: string,
  rows: ReadonlyArray<BoardRow>
): ProjectCard & { readonly latest: number } => {
  const other = id === otherProjectID
  const open = rows.filter(item => item.row.state !== 'handled')

  const count = (states: ReadonlyArray<FleetState>) =>
    rows.filter(item => states.includes(item.row.state)).length

  const sections = other
    ? [{ directory: '/', name: 'Other', rows: open.toSorted(sectionOrder) }]
    : Array.from(
        groupBy(open, item => item.row.directory),
        ([directory, items]) => ({
          directory,
          name: items[0]?.worktree ?? lastSegment(directory),
          rows: items.toSorted(sectionOrder)
        })
      ).toSorted((left, right) => latest(right.rows) - latest(left.rows))

  return {
    id,
    name: other ? 'Other' : (live.projects.get(id)?.name ?? rows[0]?.project ?? id),
    other,
    needMe: count(['blocked', 'finished']),
    working: count(['working']),
    sections: sections.filter(section => section.rows.length > 0),
    handled: rows.filter(item => item.row.state === 'handled').toSorted(newestFirst),
    latest: latest(rows)
  }
}

/**
 * The Projects grid: one card per project (every session, no time limit), by latest activity;
 * "Other" last.
 */
export const buildProjectCards = (live: LiveFleet): ReadonlyArray<ProjectCard> => {
  const cards = Array.from(
    groupBy(allRows(live), item => projectKey(live, item.row)),
    ([id, rows]) => projectCard(live, id, rows)
  )

  return cards
    .toSorted(
      (left, right) =>
        Number(left.other) - Number(right.other) ||
        right.latest - left.latest ||
        left.name.localeCompare(right.name)
    )
    .map(({ latest: _latest, ...card }) => card)
}

/** A card section with the launcher's facts for its worktree (branch, owner, PR), if any. */
export type WorktreeSection = CardSection & { readonly worktree: LauncherWorktree | undefined }

/**
 * A card's sections with the launcher's worktree facts: each section gets the linked worktree it
 * runs in; the repository's other branch worktrees follow as sections without sessions, so their
 * PR state and Retire show too (detached ones only show with sessions).
 */
export const cardSections = (
  card: ProjectCard,
  entry: LauncherEntry | undefined
): ReadonlyArray<WorktreeSection> => {
  if (entry === undefined || card.other) {
    return card.sections.map(section => ({ ...section, worktree: undefined }))
  }

  const sections = card.sections.map(section => ({
    ...section,
    worktree: entry.worktrees.find(worktree => isWithin(section.directory, worktree.directory))
  }))

  const shown = new Set(sections.map(section => section.worktree?.directory))

  const idle = entry.worktrees
    .filter(worktree => worktree.branch !== undefined && !shown.has(worktree.directory))
    .map((worktree): WorktreeSection => ({
      directory: worktree.directory,
      name: worktreeName(worktree),
      rows: [],
      worktree
    }))

  return [...sections, ...idle]
}
