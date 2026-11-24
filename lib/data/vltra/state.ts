import type { TrackedSession } from '@/lib/data/vltra/model'
import { vltraStatePriority } from '@/lib/data/vltra/types'
import type {
  VltraChildRow,
  VltraCounts,
  VltraRow,
  VltraState,
  SessionRecord,
  SessionShell
} from '@/lib/data/vltra/types'

/** A working session with no step/tool/text activity for this long is quiet (stuck). */
export const quietAfter = 10 * 60 * 1000

/**
 * Whether I handled the latest run: `metadata.vltra.handled >= idle`. A session that never ran
 * (no `idle`) has nothing to handle.
 */
export const isHandled = (info: Pick<SessionRecord, 'idle' | 'handled'>): boolean =>
  info.idle === undefined || (info.handled !== undefined && info.handled >= info.idle)

/**
 * Whether I reopened the latest run of a session whose folder is gone:
 * `metadata.vltra.reopened >= idle`, and not handled since.
 */
export const isReopened = (info: Pick<SessionRecord, 'idle' | 'handled' | 'reopened'>): boolean =>
  info.idle !== undefined &&
  info.reopened !== undefined &&
  info.reopened >= info.idle &&
  !isHandled(info)

/**
 * A session's own state, before roll-up. Priority: blocked > working > (folder gone → handled) >
 * finished > handled.
 *
 * - blocked: a permission or form is pending on this session.
 * - working: an execution is active.
 * - handled when its folder is gone (deleting the folder retires its sessions), unless I reopened
 *   its latest run. What OpenCode still reports (pending requests, a running execution) wins.
 * - finished: the latest run ended (any outcome) and is not handled. While a shell it started
 *   still runs (a background script; OpenCode wakes the agent when it exits), it is working.
 * - handled: the latest run is handled, or the session never ran. A script left running after
 *   that (a dev server) does not bring it back.
 */
export const ownState = (
  session: TrackedSession,
  pending: number,
  gone: boolean,
  shells = 0
): VltraState => {
  if (pending > 0) return 'blocked'

  if (session.running) return 'working'

  if (gone && !isReopened(session.info)) return 'handled'

  if (!isHandled(session.info)) return shells > 0 ? 'working' : 'finished'

  return 'handled'
}

const rank = (state: VltraState) => vltraStatePriority.indexOf(state)

export const highestPriority = (states: ReadonlyArray<VltraState>): VltraState =>
  states.reduce<VltraState>((best, state) => (rank(state) < rank(best) ? state : best), 'handled')

/** Descendant states that propagate to ancestors; a subagent's finished run does not. */
const inherited: ReadonlyArray<VltraState> = ['blocked', 'working']

export const rollUpState = (own: VltraState, descendants: ReadonlyArray<VltraState>): VltraState =>
  highestPriority([own, ...descendants.filter(state => inherited.includes(state))])

export const compareStates = (left: VltraState, right: VltraState): number =>
  rank(left) - rank(right)

/**
 * Recency for ordering: the latest start or activity while running, else the end of the latest
 * run, else creation. Never `time.updated` (metadata writes bump it).
 */
export const activeAt = (session: TrackedSession): number => {
  const fallback = session.info.idle ?? session.info.created

  if (!session.running) return fallback

  const live = Math.max(session.startedAt ?? 0, session.activityAt ?? 0)

  return live > 0 ? live : fallback
}

type LiveFacts = Pick<VltraChildRow, 'running' | 'retry' | 'activityAt'>

const runningRows = (row: VltraRow): ReadonlyArray<LiveFacts> =>
  [row, ...row.children].filter(item => item.running)

/** Latest activity across the row's running subtree (a parent waits while a subagent works). */
export const lastActivityAt = (row: VltraRow): number | undefined => {
  const times = runningRows(row).flatMap(item =>
    item.activityAt === undefined ? [] : [item.activityAt]
  )

  return times.length === 0 ? undefined : Math.max(...times)
}

/** The retry a running session in the row's subtree is waiting on, if any. */
export const pendingRetry = (row: VltraRow) =>
  runningRows(row).find(item => item.retry !== undefined)?.retry

/** A shell whose process tree listens on a port: a service (dev server), not a script to wait on. */
export const isService = (shell: SessionShell): boolean => shell.ports.length > 0

/**
 * The background scripts a working row only waits on: nothing in its subtree runs, and the
 * sessions working because of a shell still hold one (services aside). Oldest first.
 */
export const waitingShells = (row: VltraRow): ReadonlyArray<SessionShell> =>
  row.state !== 'working' || runningRows(row).length > 0
    ? []
    : [row, ...row.children]
        .filter(item => item.ownState === 'working')
        .flatMap(item => item.shells.filter(shell => !isService(shell)))
        .toSorted((left, right) => left.started - right.started)

/** The services (shells listening on a port) still running in the row's subtree. */
export const servingShells = (row: VltraRow): ReadonlyArray<SessionShell> =>
  [row, ...row.children].flatMap(item => item.shells.filter(isService))

/**
 * Whether Done applies: the latest run finished, or it ended and only waits on background
 * scripts (a watcher that never exits would otherwise hold it working for good).
 */
export const canMarkDone = (row: VltraRow): boolean =>
  row.state === 'finished' || waitingShells(row).length > 0

/** Working, and nothing in its running subtree has done anything for `quietAfter`. */
export const isQuiet = (row: VltraRow, now: number): boolean => {
  const last = lastActivityAt(row)

  return row.state === 'working' && last !== undefined && now - last >= quietAfter
}

/** Stuck is not a state: a working row that is retrying or quiet. */
export const isStuck = (row: VltraRow, now: number): boolean =>
  row.state === 'working' && (pendingRetry(row) !== undefined || isQuiet(row, now))

/** Root rows by rolled-up state, plus the stuck working ones. */
export const countRows = (rows: ReadonlyArray<VltraRow>, now: number): VltraCounts => {
  const counts = { blocked: 0, finished: 0, working: 0, stuck: 0, handled: 0 }

  for (const row of rows) {
    counts[row.state] += 1

    if (isStuck(row, now)) counts.stuck += 1
  }

  return counts
}
