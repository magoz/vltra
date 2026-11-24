import type { TrackedSession } from '@/lib/data/vltra/model'
import { vltraStatePriority } from '@/lib/data/vltra/types'
import type {
  VltraChildRow,
  VltraCounts,
  VltraRow,
  VltraState,
  SessionRecord,
  SessionService,
  SessionWait
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
 * - finished: the latest run ended (any outcome) and is not handled. While something will wake
 *   its agent (`waits`: a background script, an `until` watch), it is working.
 * - handled: the latest run is handled, or the session never ran. A wait left after that does
 *   not bring it back.
 */
export const ownState = (
  session: TrackedSession,
  pending: number,
  gone: boolean,
  waits = 0
): VltraState => {
  if (pending > 0) return 'blocked'

  if (session.running) return 'working'

  if (gone && !isReopened(session.info)) return 'handled'

  if (!isHandled(session.info)) return waits > 0 ? 'working' : 'finished'

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

/**
 * What a working row only waits on (scripts, `until` watches): nothing in its subtree runs, and
 * the sessions working because of a wait still hold one. Oldest first.
 */
export const waitingOn = (row: VltraRow): ReadonlyArray<SessionWait> =>
  row.state !== 'working' || runningRows(row).length > 0
    ? []
    : [row, ...row.children]
        .filter(item => item.ownState === 'working')
        .flatMap(item => item.waits)
        .toSorted((left, right) => left.started - right.started)

/** Working only because something will wake its agent: nothing in it runs. */
export const isWaiting = (row: VltraRow): boolean => waitingOn(row).length > 0

/** The services (shells listening on a port) still running in the row's subtree. */
export const servicesOf = (row: VltraRow): ReadonlyArray<SessionService> =>
  [row, ...row.children].flatMap(item => item.services)

/**
 * Whether Done applies: the latest run finished, or it ended and only waits (a watcher that never
 * exits, a watch I no longer care about, would otherwise hold it working for good).
 */
export const canMarkDone = (row: VltraRow): boolean => row.state === 'finished' || isWaiting(row)

/** Working, and nothing in its running subtree has done anything for `quietAfter`. */
export const isQuiet = (row: VltraRow, now: number): boolean => {
  const last = lastActivityAt(row)

  return row.state === 'working' && last !== undefined && now - last >= quietAfter
}

/**
 * Past its next check or its deadline by this much, an `until` watch is overdue: nothing checks
 * it (its location stays unloaded), or its wake never came. Leaves room for a slow check (30 s)
 * and wake retries (up to 30 s), and for the minute between refreshes.
 */
export const overdueAfter = 2 * 60 * 1000

type WatchWait = Extract<SessionWait, { readonly kind: 'watch' }>

/** When the watch should have done something by: its next check, or its deadline if sooner. */
export const watchDueAt = (wait: WatchWait): number =>
  Math.min(wait.nextAt, wait.expiresAt ?? wait.nextAt)

/** The watches a waiting row holds on that are overdue (see `overdueAfter`), most overdue first. */
export const overdueWatches = (row: VltraRow, now: number): ReadonlyArray<WatchWait> =>
  waitingOn(row)
    .flatMap(wait =>
      wait.kind === 'watch' && now - watchDueAt(wait) >= overdueAfter ? [wait] : []
    )
    .toSorted((left, right) => watchDueAt(left) - watchDueAt(right))

/** Stuck is not a state: a working row that is retrying, quiet, or waits on an overdue watch. */
export const isStuck = (row: VltraRow, now: number): boolean =>
  row.state === 'working' &&
  (pendingRetry(row) !== undefined || isQuiet(row, now) || overdueWatches(row, now).length > 0)

/** Root rows by rolled-up state, plus the stuck and the waiting working ones. */
export const countRows = (rows: ReadonlyArray<VltraRow>, now: number): VltraCounts => {
  const counts = { blocked: 0, finished: 0, working: 0, stuck: 0, waiting: 0, handled: 0 }

  for (const row of rows) {
    counts[row.state] += 1

    if (isStuck(row, now)) counts.stuck += 1

    if (isWaiting(row)) counts.waiting += 1
  }

  return counts
}
