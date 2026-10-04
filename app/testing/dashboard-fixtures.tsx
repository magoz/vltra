import { useState } from 'react'
import type { ReactNode } from 'react'
import { CurrentTab } from '@/app/current-tab'
import { FleetActionResult, FleetActionValue } from '@/app/fleet-action-result'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { FleetProvider } from '@/app/fleet-context'
import type { FleetNav, SessionSelection } from '@/app/fleet-context'
import { fleetHref, moveTo } from '@/app/fleet-href'
import type { FleetPlace, FleetScreen } from '@/app/fleet-href'
import { FleetShell } from '@/app/fleet-shell'
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
  | { readonly action: 'newSession'; readonly input: Input<'newSession'> }
  | { readonly action: 'retireWorktree'; readonly input: Input<'retireWorktree'> }
  | { readonly action: 'deleteProject'; readonly input: Input<'deleteProject'> }
  | { readonly action: 'suggestBranch'; readonly input: Input<'suggestBranch'> }

/** What the fake value actions answer (a suggestion per task, else the fallback-like default). */
export type FakeValues = {
  readonly launchID: string
  readonly opened: { readonly sessionID: string }
  readonly suggest: (task: string) => {
    readonly branch: string
    readonly source: 'model' | 'fallback'
  }
}

const defaultValues: FakeValues = {
  launchID: 'launch-1',
  opened: { sessionID: 'ses_opened' },
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
    newSession: input => recordValue({ action: 'newSession', input }, answers.opened),
    retireWorktree: input => record({ action: 'retireWorktree', input }),
    deleteProject: input => record({ action: 'deleteProject', input }),
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

/** A tab-and-session stand-in for card tests: the Agents tab, nothing open. */
const staticNav: FleetNav = {
  screen: 'focus',
  project: undefined,
  href: (screen, project) => fleetHref(screen, { project }),
  show: () => undefined,
  setProject: () => undefined,
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
 * A navigation the test dashboard made: a tab switch (`show`, where it landed), a filter change
 * in place, or a session opened on the Agents tab (the launcher).
 */
export type NavCall =
  | { readonly kind: 'show'; readonly screen: FleetScreen; readonly project: string | undefined }
  | { readonly kind: 'filter'; readonly project: string | undefined }
  | { readonly kind: 'open'; readonly session: string }

/**
 * The whole dashboard as the layout renders it, with the URL kept in state: the tab, the filter
 * and the open session (`session` opens one at the start). Moves follow the same `moveTo` as the
 * real navigation. `navigations` records them; `testLocation` reads the URL the state stands for.
 */
export function TestDashboard({
  live,
  now,
  actions,
  screen: initialScreen = 'focus',
  project: initialProject,
  session,
  navigations = []
}: {
  readonly live: LiveFleet
  readonly now: number
  readonly actions: FleetActions
  readonly screen?: FleetScreen
  readonly project?: string
  readonly session?: string
  readonly navigations?: Array<NavCall>
}) {
  const [selected, setSelected] = useState<string | undefined>(session)

  const [place, setPlace] = useState<FleetPlace>(() =>
    moveTo({ screen: 'focus', project: undefined }, initialScreen, initialProject)
  )

  const nav: FleetNav = {
    screen: place.screen,
    project: place.project,
    href: (target, filter) => {
      const to = moveTo(place, target, filter)

      return fleetHref(to.screen, { project: to.project, session: selected })
    },
    show: (target, filter) => {
      const to = moveTo(place, target, filter)

      if (to.screen === place.screen && to.project === place.project) return

      navigations.push({ kind: 'show', screen: to.screen, project: to.project })
      setPlace(to)
    },
    setProject: filter => {
      navigations.push({ kind: 'filter', project: filter })
      setPlace({ screen: place.screen, project: filter })
    },
    openSession: sessionID => {
      navigations.push({ kind: 'open', session: sessionID })
      setPlace({ screen: 'focus', project: undefined })
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
        <CurrentTab />
      </FleetShell>
      <Toaster theme="light" />
      <output
        hidden
        data-location={fleetHref(place.screen, { project: place.project, session: selected })}
      />
    </FleetActionsProvider>
  )
}

/** The URL a rendered `TestDashboard` stands for. */
export const testLocation = () =>
  document.querySelector('output[data-location]')?.getAttribute('data-location')
