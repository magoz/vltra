import type { TrackedSession } from '@/lib/data/fleet/model'
import { fleetStatePriority } from '@/lib/data/fleet/types'
import type {
  FleetChildRow,
  FleetCounts,
  FleetRow,
  FleetState,
  SessionRecord
} from '@/lib/data/fleet/types'

/** A working session with no step/tool/text activity for this long is quiet (stuck). */
export const quietAfter = 10 * 60 * 1000

/**
 * Whether I handled the latest run: `metadata.fleet.handled >= idle`. A session that never ran
 * (no `idle`) has nothing to handle.
 */
export const isHandled = (info: Pick<SessionRecord, 'idle' | 'handled'>): boolean =>
  info.idle === undefined || (info.handled !== undefined && info.handled >= info.idle)

/**
 * A session's own state, before roll-up. Priority: blocked > working > finished > handled.
 *
 * - blocked: a permission or form is pending on this session.
 * - working: an execution is active.
 * - finished: the latest run ended (any outcome) and is not handled.
 * - handled: the latest run is handled, or the session never ran.
 */
export const ownState = (session: TrackedSession, pending: number): FleetState => {
  if (pending > 0) return 'blocked'

  if (session.running) return 'working'

  if (!isHandled(session.info)) return 'finished'

  return 'handled'
}

const rank = (state: FleetState) => fleetStatePriority.indexOf(state)

export const highestPriority = (states: ReadonlyArray<FleetState>): FleetState =>
  states.reduce<FleetState>((best, state) => (rank(state) < rank(best) ? state : best), 'handled')

/** Descendant states that propagate to ancestors; a subagent's finished run does not. */
const inherited: ReadonlyArray<FleetState> = ['blocked', 'working']

export const rollUpState = (own: FleetState, descendants: ReadonlyArray<FleetState>): FleetState =>
  highestPriority([own, ...descendants.filter(state => inherited.includes(state))])

export const compareStates = (left: FleetState, right: FleetState): number =>
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

type LiveFacts = Pick<FleetChildRow, 'running' | 'retry' | 'activityAt'>

const runningRows = (row: FleetRow): ReadonlyArray<LiveFacts> =>
  [row, ...row.children].filter(item => item.running)

/** Latest activity across the row's running subtree (a parent waits while a subagent works). */
export const lastActivityAt = (row: FleetRow): number | undefined => {
  const times = runningRows(row).flatMap(item =>
    item.activityAt === undefined ? [] : [item.activityAt]
  )

  return times.length === 0 ? undefined : Math.max(...times)
}

/** The retry a running session in the row's subtree is waiting on, if any. */
export const pendingRetry = (row: FleetRow) =>
  runningRows(row).find(item => item.retry !== undefined)?.retry

/** Working, and nothing in its running subtree has done anything for `quietAfter`. */
export const isQuiet = (row: FleetRow, now: number): boolean => {
  const last = lastActivityAt(row)

  return row.state === 'working' && last !== undefined && now - last >= quietAfter
}

/** Stuck is not a state: a working row that is retrying or quiet. */
export const isStuck = (row: FleetRow, now: number): boolean =>
  row.state === 'working' && (pendingRetry(row) !== undefined || isQuiet(row, now))

/** Root rows by rolled-up state, plus the stuck working ones. */
export const countRows = (rows: ReadonlyArray<FleetRow>, now: number): FleetCounts => {
  const counts = { blocked: 0, finished: 0, working: 0, stuck: 0, handled: 0 }

  for (const row of rows) {
    counts[row.state] += 1

    if (isStuck(row, now)) counts.stuck += 1
  }

  return counts
}
