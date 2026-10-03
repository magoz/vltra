import type { ReactNode } from 'react'
import { FleetActionResult } from '@/app/fleet-action-result'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { fromSnapshot as liveFromSnapshot } from '@/lib/data/fleet/board'
import type { BoardRow, LiveFleet } from '@/lib/data/fleet/board'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { FleetModel, OpenCodeSnapshot, TrackedSession } from '@/lib/data/fleet/model'
import { buildRows, buildSnapshot } from '@/lib/data/fleet/snapshot'
import { baseTime, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { FleetRow } from '@/lib/data/fleet/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

// Rows and live fleets for component tests, built through the real model and snapshot projection.

type LiveFacts = Partial<Pick<TrackedSession, 'activity' | 'retry' | 'activityAt' | 'interrupt'>>

const modelFrom = (
  snapshot: Partial<OpenCodeSnapshot>,
  live: ReadonlyMap<string, LiveFacts>,
  at: number,
  gone: ReadonlyArray<string> = []
): FleetModel => {
  const model = fromSnapshot(
    { ...emptySnapshot, ...snapshot },
    at,
    new Map(gone.map(directory => [directory, true] as const))
  )

  const sessions = new Map(model.sessions)

  for (const [id, facts] of live) {
    const session = sessions.get(id)

    if (session !== undefined) sessions.set(id, { ...session, ...facts })
  }

  return { ...model, sessions }
}

/** The root row `id`; `gone` lists session folders deleted from disk. */
export const rowFrom = (
  snapshot: Partial<OpenCodeSnapshot>,
  id: string,
  live: LiveFacts = {},
  gone: ReadonlyArray<string> = []
): FleetRow => {
  const model = modelFrom(snapshot, new Map([[id, live]]), baseTime, gone)
  const row = buildRows(model, webUrl).find(candidate => candidate.id === id)

  if (row === undefined) throw new Error(`no root row ${id}`)

  return row
}

/** A live fleet as the dashboard sees it after loading `GET /api/fleet` at `now`. */
export const liveFrom = (
  snapshot: Partial<OpenCodeSnapshot>,
  now: number,
  live: ReadonlyMap<string, LiveFacts> = new Map()
): LiveFleet =>
  liveFromSnapshot(
    buildSnapshot(modelFrom(snapshot, live, now), {
      connection: { status: 'connected', since: now, failures: 0, version: '2.0.20' },
      webUrl,
      now
    })
  )

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

const noRows: ReadonlyMap<string, FleetRow> = new Map()

function WithHandled({
  actions,
  rows,
  children
}: {
  readonly actions: FleetActions
  readonly rows: ReadonlyMap<string, FleetRow>
  readonly children: ReactNode
}) {
  const flow = useHandledFlow(actions, rows)

  return <HandledProvider flow={flow}>{children}</HandledProvider>
}

/** The dashboard's providers: `actions`, and Handled / Undo / Reopen over `rows`. */
export function WithActions({
  actions,
  rows = noRows,
  children
}: {
  readonly actions: FleetActions
  readonly rows?: ReadonlyMap<string, FleetRow> | undefined
  readonly children: ReactNode
}) {
  return (
    <FleetActionsProvider actions={actions}>
      <WithHandled actions={actions} rows={rows}>
        {children}
      </WithHandled>
    </FleetActionsProvider>
  )
}
