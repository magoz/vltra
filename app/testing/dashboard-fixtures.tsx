import { act } from '@testing-library/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Agents } from '@/app/agents'
import { FleetActionResult, FleetActionValue } from '@/app/fleet-action-result'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { FleetProvider } from '@/app/fleet-context'
import type { FleetNav, SessionSelection } from '@/app/fleet-context'
import { fleetHref } from '@/app/fleet-href'
import type { AgentsView, FleetPage } from '@/app/fleet-href'
import { FleetShell } from '@/app/fleet-shell'
import { ProjectsGrid } from '@/app/projects-grid'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { Toaster } from '@/components/ui/sonner'
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
  | { readonly action: 'launch'; readonly input: Input<'launch'> }
  | { readonly action: 'dismissLaunch'; readonly input: Input<'dismissLaunch'> }
  | { readonly action: 'openCheckout'; readonly input: Input<'openCheckout'> }
  | { readonly action: 'retireWorktree'; readonly input: Input<'retireWorktree'> }
  | { readonly action: 'suggestBranch'; readonly input: Input<'suggestBranch'> }

/** What the fake value actions answer (a suggestion per task, else the fallback-like default). */
export type FakeValues = {
  readonly launchID: string
  readonly opened: { readonly sessionID: string; readonly created: boolean }
  readonly suggest: (task: string) => {
    readonly branch: string
    readonly source: 'model' | 'fallback'
  }
}

const defaultValues: FakeValues = {
  launchID: 'launch-1',
  opened: { sessionID: 'ses_opened', created: false },
  suggest: () => ({ branch: 'feat/suggested-name', source: 'model' })
}

/**
 * Recording fake actions; `failWith` makes every action return that error message, `values` sets
 * what the value actions (launch, open, suggest) answer.
 */
export const fakeActions = (failWith?: string, values: Partial<FakeValues> = {}) => {
  const calls: Array<ActionCall> = []
  const answers = { ...defaultValues, ...values }

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

  const recordValue = <A,>(call: ActionCall, value: A): Promise<FleetActionValue<A>> => {
    calls.push(call)

    return Promise.resolve(
      failWith === undefined
        ? FleetActionValue.Success(value)
        : FleetActionResult.Error({ message: failWith })
    )
  }

  const actions: FleetActions = {
    markHandled: input => record({ action: 'markHandled', input }),
    reopen: input => record({ action: 'reopen', input }),
    markViewed: input => record({ action: 'markViewed', input }),
    launch: input => recordValue({ action: 'launch', input }, { launchID: answers.launchID }),
    dismissLaunch: input => record({ action: 'dismissLaunch', input }),
    openCheckout: input => recordValue({ action: 'openCheckout', input }, answers.opened),
    retireWorktree: input => record({ action: 'retireWorktree', input }),
    suggestBranch: input =>
      recordValue({ action: 'suggestBranch', input }, answers.suggest(input.task))
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

/** A page-and-session stand-in for card tests: the Agents page, nothing open. */
const staticNav: FleetNav = {
  page: 'agents',
  view: 'focus',
  project: undefined,
  href: (page, project, view) => fleetHref(page, { project, view }),
  go: () => undefined,
  setProject: () => undefined,
  setView: () => undefined,
  openSession: () => undefined
}

/**
 * The dashboard's providers for one card or row: `actions`, Handled / Undo / Reopen over `rows`,
 * and the fleet context (`onSelect` records session opens).
 */
export function WithFleet({
  actions,
  rows = noRows,
  now,
  onSelect = () => undefined,
  children
}: {
  readonly actions: FleetActions
  readonly rows?: ReadonlyMap<string, FleetRow> | undefined
  readonly now: number
  readonly onSelect?: (sessionID: string) => void
  readonly children: ReactNode
}) {
  const view: LiveFleet = {
    connection: { status: 'connected', since: now, failures: 0 },
    rows,
    projects: new Map(),
    worktrees: new Map(),
    launches: []
  }

  const fleet = {
    view,
    now,
    selection: { selected: undefined, select: onSelect, close: () => undefined },
    nav: staticNav
  }

  return (
    <WithActions actions={actions} rows={rows}>
      <FleetProvider fleet={fleet}>{children}</FleetProvider>
    </WithActions>
  )
}

/**
 * A navigation the test dashboard made: a page switch (`go`), a filter change in place, an Agents
 * mode switch, or a session opened in focus mode (the launcher).
 */
export type NavCall =
  | {
      readonly kind: 'go'
      readonly page: FleetPage
      readonly project: string | undefined
      readonly view: AgentsView
    }
  | { readonly kind: 'filter'; readonly project: string | undefined }
  | { readonly kind: 'view'; readonly view: AgentsView }
  | { readonly kind: 'open'; readonly session: string }

/**
 * The whole dashboard as the layout renders it, with the URL kept in state: the page, the Agents
 * mode, the project filter and the open session (`session` opens one at the start).
 * `navigations` records page switches, filter changes and mode switches; `testLocation` reads the
 * URL the state stands for.
 */
export function TestDashboard({
  live,
  now,
  actions,
  page: initialPage = 'agents',
  view: initialView = 'focus',
  project: initialProject,
  session,
  navigations = []
}: {
  readonly live: LiveFleet
  readonly now: number
  readonly actions: FleetActions
  readonly page?: FleetPage
  readonly view?: AgentsView
  readonly project?: string
  readonly session?: string
  readonly navigations?: Array<NavCall>
}) {
  const [page, setPage] = useState<FleetPage>(initialPage)
  const [view, setView] = useState<AgentsView>(initialView)
  const [project, setProject] = useState(initialProject)
  const [selected, setSelected] = useState<string | undefined>(session)

  const nav: FleetNav = {
    page,
    view,
    project,
    href: (target, filter, mode) =>
      fleetHref(target, { project: filter, session: selected, view: mode ?? view }),
    go: (target, filter, mode) => {
      navigations.push({ kind: 'go', page: target, project: filter, view: mode ?? view })
      setPage(target)
      setProject(target === 'agents' ? filter : undefined)
      setView(mode ?? view)
    },
    setProject: filter => {
      navigations.push({ kind: 'filter', project: filter })
      setProject(filter)
    },
    setView: mode => {
      if (mode === view) return

      navigations.push({ kind: 'view', view: mode })
      setView(mode)
    },
    openSession: sessionID => {
      navigations.push({ kind: 'open', session: sessionID })
      setPage('agents')
      setView('focus')
      setProject(undefined)
      setSelected(sessionID)
    }
  }

  const selection: SessionSelection = {
    selected,
    select: setSelected,
    close: () => setSelected(undefined)
  }

  return (
    <FleetActionsProvider actions={actions}>
      <FleetShell live={live} stream="live" now={now} selection={selection} nav={nav}>
        {page === 'agents' ? <Agents /> : <ProjectsGrid />}
      </FleetShell>
      <Toaster theme="light" />
      <output hidden data-location={fleetHref(page, { project, session: selected, view })} />
    </FleetActionsProvider>
  )
}

/** The URL a rendered `TestDashboard` stands for. */
export const testLocation = () =>
  document.querySelector('output[data-location]')?.getAttribute('data-location')

/** Waits out a session switch: the panel swaps after the next paint (`use-panel-session.ts`). */
export const afterPaint = () =>
  act(() => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))))
