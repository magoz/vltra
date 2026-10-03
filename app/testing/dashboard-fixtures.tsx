import type { ReactNode } from 'react'
import { FleetActionResult } from '@/app/fleet-action-result'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import type { BoardRow } from '@/lib/data/fleet/board'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot, TrackedSession } from '@/lib/data/fleet/model'
import { buildRows } from '@/lib/data/fleet/snapshot'
import { baseTime, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

// Rows for component tests, built through the real model and snapshot projection.

export const rowFrom = (
  snapshot: Partial<OpenCodeSnapshot>,
  id: string,
  live: Partial<Pick<TrackedSession, 'activity' | 'retry' | 'activityAt' | 'interrupt'>> = {}
): FleetRow => {
  const model = fromSnapshot({ ...emptySnapshot, ...snapshot }, baseTime)
  const session = model.sessions.get(id)

  const patched =
    session === undefined
      ? model
      : { ...model, sessions: new Map(model.sessions).set(id, { ...session, ...live }) }

  const row = buildRows(patched, webUrl).find(candidate => candidate.id === id)

  if (row === undefined) throw new Error(`no root row ${id}`)

  return row
}

export const itemFor = (row: FleetRow, worktree?: string): BoardRow => ({
  row,
  project: 'fleet',
  worktree
})

type Input<K extends keyof FleetActions> = Parameters<FleetActions[K]>[0]

export type ActionCall =
  | { readonly action: 'markHandled'; readonly input: Input<'markHandled'> }
  | { readonly action: 'reopen'; readonly input: Input<'reopen'> }
  | { readonly action: 'markViewed'; readonly input: Input<'markViewed'> }
  | { readonly action: 'replyPermission'; readonly input: Input<'replyPermission'> }
  | { readonly action: 'replyForm'; readonly input: Input<'replyForm'> }
  | { readonly action: 'sendPrompt'; readonly input: Input<'sendPrompt'> }
  | { readonly action: 'interrupt'; readonly input: Input<'interrupt'> }

/** Recording fake actions; `failWith` makes every action return that error message. */
export const fakeActions = (failWith?: string) => {
  const calls: Array<ActionCall> = []

  const result = () =>
    Promise.resolve(
      failWith === undefined
        ? FleetActionResult.Success()
        : FleetActionResult.Error({ message: failWith })
    )

  const record = (call: ActionCall): Promise<FleetActionResult> => {
    calls.push(call)

    return result()
  }

  const actions: FleetActions = {
    markHandled: input => record({ action: 'markHandled', input }),
    reopen: input => record({ action: 'reopen', input }),
    markViewed: input => record({ action: 'markViewed', input }),
    replyPermission: input => record({ action: 'replyPermission', input }),
    replyForm: input => record({ action: 'replyForm', input }),
    sendPrompt: input => record({ action: 'sendPrompt', input }),
    interrupt: input => record({ action: 'interrupt', input })
  }

  return { actions, calls }
}

export function WithActions({
  actions,
  children
}: {
  readonly actions: FleetActions
  readonly children: ReactNode
}) {
  return <FleetActionsProvider actions={actions}>{children}</FleetActionsProvider>
}
