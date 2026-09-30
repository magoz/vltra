import type { TrackedSession } from '@/lib/data/fleet/model'
import { fleetStatePriority } from '@/lib/data/fleet/types'
import type { FleetState, SessionRecord } from '@/lib/data/fleet/types'

/** OpenCode's own unread rule (core `session/session.ts`): finished and `viewed < idle`. */
export const isUnseen = (info: SessionRecord): boolean =>
  info.idle !== undefined && (info.viewed === undefined || info.viewed < info.idle)

/**
 * A session's own state, before roll-up. Priority: needs-you > failed > working > done > idle.
 *
 * - needs-you: a permission or form is pending on this session.
 * - failed: the last run failed and is unseen, or a step failed in the current/last run.
 * - working: an execution is active.
 * - done: the last run finished (succeeded or interrupted) and is unseen.
 * - idle: nothing new.
 */
export const ownState = (session: TrackedSession, pending: number): FleetState => {
  if (pending > 0) return 'needs-you'

  const unseen = isUnseen(session.info)

  if (session.stepFailed) return 'failed'

  if (!session.running && unseen && session.info.outcome === 'failed') return 'failed'

  if (session.running) return 'working'

  if (unseen) return 'done'

  return 'idle'
}

const rank = (state: FleetState) => fleetStatePriority.indexOf(state)

export const highestPriority = (states: ReadonlyArray<FleetState>): FleetState =>
  states.reduce<FleetState>((best, state) => (rank(state) < rank(best) ? state : best), 'idle')

/** Descendant states that propagate to ancestors: a parent is needs-you/working if any child is. */
const inherited: ReadonlyArray<FleetState> = ['needs-you', 'working']

export const rollUpState = (own: FleetState, descendants: ReadonlyArray<FleetState>): FleetState =>
  highestPriority([own, ...descendants.filter(state => inherited.includes(state))])

export const compareStates = (left: FleetState, right: FleetState): number =>
  rank(left) - rank(right)
