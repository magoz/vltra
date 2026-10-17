'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { VltraActionResult } from '@/app/vltra-action-result'
import type { VltraActionFailure, VltraActionValue } from '@/app/vltra-action-result'
import type {
  DeleteProjectInput,
  MarkHandledInput,
  MarkViewedInput,
  ReopenInput
} from '@/lib/data/vltra/actions'
import type {
  DismissLaunchInput,
  LaunchInput,
  NewSession,
  NewSessionInput,
  RetireWorktreeInput,
  SuggestBranchInput
} from '@/lib/data/vltra/launcher'
import type { PushDeviceInput, SavePushDeviceInput } from '@/lib/data/vltra/push'
import type { BranchSuggestion, PushDevice } from '@/lib/data/vltra/types'

/** The mutations the dashboard can run; the server actions in production, fakes in tests. */
export type VltraActions = {
  readonly markHandled: (input: MarkHandledInput) => Promise<VltraActionResult>
  readonly reopen: (input: ReopenInput) => Promise<VltraActionResult>
  readonly markViewed: (input: MarkViewedInput) => Promise<VltraActionResult>
  /** Start a new worktree + session (returns at once; progress comes with the vltra). */
  readonly launch: (input: LaunchInput) => Promise<VltraActionValue<{ readonly launchID: string }>>
  readonly dismissLaunch: (input: DismissLaunchInput) => Promise<VltraActionResult>
  /** A new empty session in a repository or worktree. */
  readonly newSession: (input: NewSessionInput) => Promise<VltraActionValue<NewSession>>
  readonly retireWorktree: (input: RetireWorktreeInput) => Promise<VltraActionResult>
  /** Delete a Projects card's sessions in OpenCode, for good. */
  readonly deleteProject: (input: DeleteProjectInput) => Promise<VltraActionResult>
  readonly suggestBranch: (input: SuggestBranchInput) => Promise<VltraActionValue<BranchSuggestion>>
  /** Turn this browser's notifications on (or refresh its subscription). */
  readonly savePushDevice: (input: SavePushDeviceInput) => Promise<VltraActionValue<PushDevice>>
  readonly removePushDevice: (input: PushDeviceInput) => Promise<VltraActionResult>
  readonly testPush: (input: PushDeviceInput) => Promise<VltraActionResult>
}

/** The action's result; a rejected call (Vltra unreachable) becomes an Error result. */
export const settled = <A,>(call: Promise<A>): Promise<A | VltraActionFailure> =>
  call.catch(() => VltraActionResult.Error({ message: 'Vltra is not reachable' }))

const VltraActionsContext = createContext<VltraActions | undefined>(undefined)

export function VltraActionsProvider({
  actions,
  children
}: {
  readonly actions: VltraActions
  readonly children: ReactNode
}) {
  return <VltraActionsContext value={actions}>{children}</VltraActionsContext>
}

export function useVltraActions(): VltraActions {
  const actions = useContext(VltraActionsContext)

  if (actions === undefined) throw new Error('useVltraActions needs a VltraActionsProvider')

  return actions
}
