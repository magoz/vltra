import type { TrackedSession } from '@/lib/data/vltra/model'
import { vltraStatePriority } from '@/lib/data/vltra/types'
import type {
  VltraChildRow,
  VltraCounts,
  VltraRow,
  VltraState,
  SessionRecord
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
 * A session's own state, before roll-up. Priority: blocked > working > (folder gone → handled) >
 * finished > handled.
 *
 * - blocked: a permission or form is pending on this session.
 * - working: an execution is active.
 * - handled when its folder is gone: OpenCode cannot write the handled marker any more (it
 *   resolves the folder for every write), so nothing is left to do. What OpenCode still reports
 *   (pending requests, a running execution) wins.
 * - finished: the latest run ended (any outcome) and is not handled.
 * - handled: the latest run is handled, or the session never ran.
 */
export const ownState = (session: TrackedSession, pending: number, gone: boolean): VltraState => {
  if (pending > 0) return 'blocked'

  if (session.running) return 'working'

  if (gone) return 'handled'

  if (!isHandled(session.info)) return 'finished'

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
