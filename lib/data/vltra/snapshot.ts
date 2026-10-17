import { sessionLinks } from '@/lib/data/vltra/links'
import { isFolderGone } from '@/lib/data/vltra/model'
import type { VltraModel, TrackedSession } from '@/lib/data/vltra/model'
import {
  activeAt,
  compareStates,
  countRows,
  highestPriority,
  ownState,
  rollUpState
} from '@/lib/data/vltra/state'
import type {
  VltraChildRow,
  VltraConnection,
  VltraProject,
  VltraRow,
  VltraSnapshot,
  VltraState,
  VltraWorktree,
  Launch,
  PendingForm,
  PendingPermission,
  WorktreeKind
} from '@/lib/data/vltra/types'

export type SnapshotOptions = {
  readonly connection: VltraConnection
  readonly webUrl: URL
  readonly now: number
  /** The launch registry's entries (none in projections that do not track launches). */
  readonly launches?: ReadonlyArray<Launch>
}

type Pending = {
  readonly permissions: ReadonlyMap<string, ReadonlyArray<PendingPermission>>
  readonly forms: ReadonlyMap<string, ReadonlyArray<PendingForm>>
}

type Tree = {
  readonly model: VltraModel
  readonly pending: Pending
  readonly children: ReadonlyMap<string, ReadonlyArray<TrackedSession>>
  readonly webUrl: URL
}

type Node = {
  readonly row: Omit<VltraChildRow, 'depth'>
  readonly descendants: ReadonlyArray<VltraChildRow>
}

const groupBySession = <V extends { readonly sessionID: string }>(
  values: Iterable<V>
): ReadonlyMap<string, ReadonlyArray<V>> => {
  const groups = new Map<string, Array<V>>()

  for (const value of values) {
    const group = groups.get(value.sessionID)

    if (group === undefined) groups.set(value.sessionID, [value])
    else group.push(value)
  }

  return groups
}

const byActiveDesc = (left: TrackedSession, right: TrackedSession) =>
  activeAt(right) - activeAt(left)

const childrenByParent = (model: VltraModel) => {
  const children = new Map<string, Array<TrackedSession>>()

  for (const session of model.sessions.values()) {
    const parentID = session.info.parentID

    if (parentID === undefined || !model.sessions.has(parentID)) continue

    const siblings = children.get(parentID)

    if (siblings === undefined) children.set(parentID, [session])
    else siblings.push(session)
  }

  for (const siblings of children.values()) siblings.sort(byActiveDesc)

  return children
}

const buildNode = (
  tree: Tree,
  session: TrackedSession,
  depth: number,
  visited: ReadonlySet<string>
): Node => {
  const info = session.info
  const permissions = tree.pending.permissions.get(info.id) ?? []
  const forms = tree.pending.forms.get(info.id) ?? []
  const gone = isFolderGone(tree.model, session)
  const own = ownState(session, permissions.length + forms.length, gone)
  const path = new Set(visited).add(info.id)

  const childNodes = (tree.children.get(info.id) ?? [])
    .filter(child => !path.has(child.info.id))
    .map(child => buildNode(tree, child, depth + 1, path))

  const descendants = childNodes.flatMap(child => [
    { ...child.row, depth: depth + 1 },
    ...child.descendants
  ])

  const row = {
    id: info.id,
    parentID: info.parentID,
    projectID: info.projectID,
    directory: info.directory,
    title: info.title,
    agent: info.agent,
    model: info.model,
    cost: info.cost,
    tokens: info.tokens,
    created: info.created,
    idle: info.idle,
    outcome: info.outcome,
    interrupt: info.outcome === 'interrupted' ? session.interrupt : undefined,
    handled: info.handled,
    viewed: info.viewed,
    gone,
    ownState: own,
    state: rollUpState(
      own,
      descendants.map(child => child.ownState)
    ),
    running: session.running,
    retry: session.running ? session.retry : undefined,
    activity: session.running ? session.activity : undefined,
    activityAt: session.running ? session.activityAt : undefined,
    activeAt: activeAt(session),
    permissions,
    forms,
    links: sessionLinks(tree.webUrl, info.id)
  } satisfies Omit<VltraChildRow, 'depth'>

  return { row, descendants }
}

const toRootRow = (node: Node): VltraRow => ({
  ...node.row,
  pending: {
    permissions: node.row.permissions.length + sum(node.descendants, row => row.permissions.length),
    forms: node.row.forms.length + sum(node.descendants, row => row.forms.length)
  },
  children: node.descendants
})

const sum = <A>(values: ReadonlyArray<A>, count: (value: A) => number) =>
  values.reduce((total, value) => total + count(value), 0)

const compareRows = (left: VltraRow, right: VltraRow) =>
  compareStates(left.state, right.state) || right.activeAt - left.activeAt

/** A root row: no parent, or a parent Vltra does not know (deleted). */
export const isRoot = (model: VltraModel, session: TrackedSession) =>
  session.info.parentID === undefined || !model.sessions.has(session.info.parentID)

/** Archived sessions only show while they are blocked or running. */
const isVisible = (session: TrackedSession, row: VltraRow) =>
  session.info.archived === undefined || row.state === 'blocked' || row.state === 'working'

/** Root rows for every visible root session, sorted by state priority then recency. */
export const buildRows = (model: VltraModel, webUrl: URL): ReadonlyArray<VltraRow> => {
  const tree: Tree = {
    model,
    webUrl,
    children: childrenByParent(model),
    pending: {
      permissions: groupBySession(model.permissions.values()),
      forms: groupBySession(model.forms.values())
    }
  }

  return Array.from(model.sessions.values())
    .filter(session => isRoot(model, session))
    .flatMap(session => {
      const row = toRootRow(buildNode(tree, session, 0, new Set()))

      return isVisible(session, row) ? [row] : []
    })
    .toSorted(compareRows)
}

const lastSegment = (directory: string) =>
  directory.split('/').findLast(segment => segment !== '') ?? directory

const worktreeKind = (
  model: VltraModel,
  projectDirectory: string | undefined,
  projectID: string,
  directory: string
): WorktreeKind => {
  if (directory === projectDirectory) return 'root'

  if ((model.worktrees.get(projectID) ?? []).includes(directory)) return 'worktree'

  return 'directory'
}

const bestState = (rows: ReadonlyArray<VltraRow>): VltraState =>
  highestPriority(rows.map(row => row.state))

const latest = (rows: ReadonlyArray<VltraRow>) => Math.max(0, ...rows.map(row => row.activeAt))

const groupBy = <A>(values: ReadonlyArray<A>, key: (value: A) => string) => {
  const groups = new Map<string, Array<A>>()

  for (const value of values) {
    const group = groups.get(key(value))

    if (group === undefined) groups.set(key(value), [value])
    else group.push(value)
  }

  return groups
}

const kindOrder: ReadonlyArray<WorktreeKind> = ['root', 'worktree', 'directory']

const compareWorktrees = (left: VltraWorktree, right: VltraWorktree) =>
  kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) ||
  compareStates(bestState(left.rows), bestState(right.rows)) ||
  latest(right.rows) - latest(left.rows)

const compareProjects = (left: VltraProject, right: VltraProject) => {
  const leftRows = left.worktrees.flatMap(worktree => worktree.rows)
  const rightRows = right.worktrees.flatMap(worktree => worktree.rows)

  return (
    compareStates(bestState(leftRows), bestState(rightRows)) || latest(rightRows) - latest(leftRows)
  )
}

/** Groups root rows as projects → worktrees → sessions. Empty projects are omitted. */
export const groupRows = (model: VltraModel, rows: ReadonlyArray<VltraRow>) =>
  Array.from(groupBy(rows, row => row.projectID))
    .map(([projectID, projectRows]): VltraProject => {
      const project = model.projects.get(projectID)
      const directory = project?.directory ?? projectRows[0]?.directory ?? projectID

      const worktrees = Array.from(groupBy(projectRows, row => row.directory))
        .map(([worktreeDirectory, worktreeRows]): VltraWorktree => ({
          directory: worktreeDirectory,
          kind: worktreeKind(model, project?.directory, projectID, worktreeDirectory),
          rows: worktreeRows
        }))
        .toSorted(compareWorktrees)

      return {
        id: projectID,
        name: project?.name ?? lastSegment(directory),
        directory,
        worktrees
      }
    })
    .toSorted(compareProjects)

/** Projects the model into the `GET /api/vltra` body. */
export const buildSnapshot = (model: VltraModel, options: SnapshotOptions): VltraSnapshot => {
  const rows = buildRows(model, options.webUrl)

  return {
    generatedAt: options.now,
    connection: options.connection,
    counts: countRows(rows, options.now),
    projects: groupRows(model, rows),
    launches: options.launches ?? []
  }
}

export const snapshotRows = (snapshot: VltraSnapshot): ReadonlyArray<VltraRow> =>
  snapshot.projects.flatMap(project => project.worktrees.flatMap(worktree => worktree.rows))
