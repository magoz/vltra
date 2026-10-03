'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { FleetActionResult } from '@/app/fleet-action-result'
import type {
  InterruptSessionInput,
  MarkHandledInput,
  MarkViewedInput,
  ReopenInput,
  ReplyFormInput,
  ReplyPermissionInput,
  SendPromptInput
} from '@/lib/data/fleet/actions'

/** The mutations the dashboard can run; the server actions in production, fakes in tests. */
export type FleetActions = {
  readonly markHandled: (input: MarkHandledInput) => Promise<FleetActionResult>
  readonly reopen: (input: ReopenInput) => Promise<FleetActionResult>
  readonly markViewed: (input: MarkViewedInput) => Promise<FleetActionResult>
  readonly replyPermission: (input: ReplyPermissionInput) => Promise<FleetActionResult>
  readonly replyForm: (input: ReplyFormInput) => Promise<FleetActionResult>
  readonly sendPrompt: (input: SendPromptInput) => Promise<FleetActionResult>
  readonly interrupt: (input: InterruptSessionInput) => Promise<FleetActionResult>
}

/** The action's result; a rejected call (Fleet unreachable) becomes an Error result. */
export const settled = (call: Promise<FleetActionResult>): Promise<FleetActionResult> =>
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
