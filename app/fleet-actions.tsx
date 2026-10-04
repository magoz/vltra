'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { FleetActionResult } from '@/app/fleet-action-result'
import type { FleetActionFailure, FleetActionValue } from '@/app/fleet-action-result'
import type {
  DeleteProjectInput,
  MarkHandledInput,
  MarkViewedInput,
  ReopenInput
} from '@/lib/data/fleet/actions'
import type {
  DismissLaunchInput,
  LaunchInput,
  OpenCheckoutInput,
  RetireWorktreeInput,
  SuggestBranchInput
} from '@/lib/data/fleet/launcher'
import type { BranchSuggestion, OpenedCheckout } from '@/lib/data/fleet/types'

/** The mutations the dashboard can run; the server actions in production, fakes in tests. */
export type FleetActions = {
  readonly markHandled: (input: MarkHandledInput) => Promise<FleetActionResult>
  readonly reopen: (input: ReopenInput) => Promise<FleetActionResult>
  readonly markViewed: (input: MarkViewedInput) => Promise<FleetActionResult>
  /** Start a new worktree + session (returns at once; progress comes with the fleet). */
  readonly launch: (input: LaunchInput) => Promise<FleetActionValue<{ readonly launchID: string }>>
  readonly dismissLaunch: (input: DismissLaunchInput) => Promise<FleetActionResult>
  /** A repository's or worktree's latest root session, or a new empty one there. */
  readonly openCheckout: (input: OpenCheckoutInput) => Promise<FleetActionValue<OpenedCheckout>>
  readonly retireWorktree: (input: RetireWorktreeInput) => Promise<FleetActionResult>
  /** Delete a Projects card's sessions in OpenCode, for good. */
  readonly deleteProject: (input: DeleteProjectInput) => Promise<FleetActionResult>
  readonly suggestBranch: (input: SuggestBranchInput) => Promise<FleetActionValue<BranchSuggestion>>
}

/** The action's result; a rejected call (Fleet unreachable) becomes an Error result. */
export const settled = <A,>(call: Promise<A>): Promise<A | FleetActionFailure> =>
  call.catch(() => FleetActionResult.Error({ message: 'Fleet is not reachable' }))

const FleetActionsContext = createContext<FleetActions | undefined>(undefined)

export function FleetActionsProvider({
  actions,
  children
}: {
  readonly actions: FleetActions
  readonly children: ReactNode
}) {
  return <FleetActionsContext value={actions}>{children}</FleetActionsContext>
}

export function useFleetActions(): FleetActions {
  const actions = useContext(FleetActionsContext)

  if (actions === undefined) throw new Error('useFleetActions needs a FleetActionsProvider')

  return actions
}
