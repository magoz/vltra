import { LauncherProvider } from '@/app/launcher-context'
import type { Launcher } from '@/app/launcher-context'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CurrentTab } from '@/app/current-tab'
import { VltraActionResult, VltraActionValue } from '@/app/vltra-action-result'
import type { VltraActions } from '@/app/vltra-actions'
import { VltraActionsProvider } from '@/app/vltra-actions'
import { VltraProvider } from '@/app/vltra-context'
import type { VltraNav, SessionSelection } from '@/app/vltra-context'
import { vltraHref, moveTo } from '@/app/vltra-href'
import type { VltraPlace, VltraScreen } from '@/app/vltra-href'
import { VltraShell } from '@/app/vltra-shell'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { Toaster } from '@/components/ui/sonner'
import { fromSnapshot as liveFromSnapshot } from '@/lib/data/vltra/board'
import type { BoardRow, LiveVltra } from '@/lib/data/vltra/board'
import { fromSnapshot } from '@/lib/data/vltra/model'
import type { VltraModel, OpenCodeSnapshot, TrackedSession } from '@/lib/data/vltra/model'
import { buildRows, buildSnapshot } from '@/lib/data/vltra/snapshot'
import { baseTime, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { VltraRow } from '@/lib/data/vltra/types'
import { defaultStatsPeriod } from '@/lib/data/vltra/stats-period'
import type { StatsPeriod } from '@/lib/data/vltra/stats-period'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

// Rows and live vltras for component tests, built through the real model and snapshot projection.

type LiveFacts = Partial<Pick<TrackedSession, 'activity' | 'retry' | 'activityAt' | 'interrupt'>>

const modelFrom = (
  snapshot: Partial<OpenCodeSnapshot>,
  live: ReadonlyMap<string, LiveFacts>,
  at: number,
  gone: ReadonlyArray<string> = []
): VltraModel => {
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
): VltraRow => {
  const model = modelFrom(snapshot, new Map([[id, live]]), baseTime, gone)
  const row = buildRows(model, webUrl).find(candidate => candidate.id === id)

  if (row === undefined) throw new Error(`no root row ${id}`)

  return row
}

/** A live vltra as the dashboard sees it after loading `GET /api/vltra` at `now`. */
export const liveFrom = (
  snapshot: Partial<OpenCodeSnapshot>,
  now: number,
  live: ReadonlyMap<string, LiveFacts> = new Map()
): LiveVltra =>
  liveFromSnapshot(
    buildSnapshot(modelFrom(snapshot, live, now), {
      connection: { status: 'connected', since: now, failures: 0, version: '2.0.20' },
      webUrl,
      now
    })
  )

export const itemFor = (row: VltraRow, worktree?: string): BoardRow => ({
  row,
  project: 'vltra',
  worktree
})

type Input<K extends keyof VltraActions> = Parameters<VltraActions[K]>[0]

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
  | { readonly action: 'savePushDevice'; readonly input: Input<'savePushDevice'> }
  | { readonly action: 'removePushDevice'; readonly input: Input<'removePushDevice'> }
  | { readonly action: 'testPush'; readonly input: Input<'testPush'> }

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
        ? VltraActionResult.Success()
        : VltraActionResult.Error({ message: failWith })
    )

  const record = (call: ActionCall): Promise<VltraActionResult> => {
    calls.push(call)

    return result()
  }

  const recordValue = <A,>(call: ActionCall, value: A): Promise<VltraActionValue<A>> => {
    calls.push(call)

    return Promise.resolve(
      failWith === undefined
        ? VltraActionValue.Success(value)
        : VltraActionResult.Error({ message: failWith })
    )
  }

  const actions: VltraActions = {
    markHandled: input => record({ action: 'markHandled', input }),
    reopen: input => record({ action: 'reopen', input }),
    markViewed: input => record({ action: 'markViewed', input }),
    launch: input => recordValue({ action: 'launch', input }, { launchID: answers.launchID }),
    dismissLaunch: input => record({ action: 'dismissLaunch', input }),
    newSession: input => recordValue({ action: 'newSession', input }, answers.opened),
    retireWorktree: input => record({ action: 'retireWorktree', input }),
    deleteProject: input => record({ action: 'deleteProject', input }),
    suggestBranch: input =>
      recordValue({ action: 'suggestBranch', input }, answers.suggest(input.task)),
    savePushDevice: input =>
      recordValue(
        { action: 'savePushDevice', input },
        { id: 'device-1', label: input.label, createdAt: 0 }
      ),
    removePushDevice: input => record({ action: 'removePushDevice', input }),
    testPush: input => record({ action: 'testPush', input })
  }

  return { actions, calls }
}

const noRows: ReadonlyMap<string, VltraRow> = new Map()

function WithHandled({
  actions,
  rows,
  children
}: {
  readonly actions: VltraActions
  readonly rows: ReadonlyMap<string, VltraRow>
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
  readonly actions: VltraActions
  readonly rows?: ReadonlyMap<string, VltraRow> | undefined
  readonly children: ReactNode
}) {
  return (
    <VltraActionsProvider actions={actions}>
      <WithHandled actions={actions} rows={rows}>
        {children}
      </WithHandled>
    </VltraActionsProvider>
  )
}

/** A tab-and-session stand-in for card tests: the Agents tab, nothing open. */
/** No launcher list (as before it loads): cards show no branch or PR. */
const noLauncher: Launcher = { list: undefined, open: () => undefined, reload: () => undefined }

const staticNav: VltraNav = {
  screen: 'focus',
  project: undefined,
  period: defaultStatsPeriod,
  href: (screen, project) => vltraHref(screen, { project }),
  show: () => undefined,
  setProject: () => undefined,
  setPeriod: () => undefined,
  openSession: () => undefined
}

/**
 * The dashboard's providers for one card or row: `actions`, Handled / Undo / Reopen over `rows`,
 * and the vltra context (`onSelect` records session opens).
 */
export function WithVltra({
  actions,
  rows = noRows,
  now,
  onSelect = () => undefined,
  children
}: {
  readonly actions: VltraActions
  readonly rows?: ReadonlyMap<string, VltraRow> | undefined
  readonly now: number
  readonly onSelect?: (sessionID: string) => void
  readonly children: ReactNode
}) {
  const view: LiveVltra = {
    connection: { status: 'connected', since: now, failures: 0 },
    rows,
    projects: new Map(),
    worktrees: new Map(),
    launches: []
  }

  const vltra = {
    view,
    now,
    selection: { selected: undefined, select: onSelect, close: () => undefined },
    nav: staticNav
  }

  return (
    <WithActions actions={actions} rows={rows}>
      <VltraProvider vltra={vltra}>
        <LauncherProvider launcher={noLauncher}>{children}</LauncherProvider>
      </VltraProvider>
    </WithActions>
  )
}

/**
 * A navigation the test dashboard made: a tab switch (`show`, where it landed), a filter change
 * in place, or a session opened on the Agents tab (the launcher).
 */
export type NavCall =
  | { readonly kind: 'show'; readonly screen: VltraScreen; readonly project: string | undefined }
  | { readonly kind: 'filter'; readonly project: string | undefined }
  | { readonly kind: 'period'; readonly period: StatsPeriod }
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
  readonly live: LiveVltra
  readonly now: number
  readonly actions: VltraActions
  readonly screen?: VltraScreen
  readonly project?: string
  readonly session?: string
  readonly navigations?: Array<NavCall>
}) {
  const [selected, setSelected] = useState<string | undefined>(session)

  const [place, setPlace] = useState<VltraPlace>(() =>
    moveTo({ screen: 'focus', project: undefined }, initialScreen, initialProject)
  )

  const [period, setPeriod] = useState<StatsPeriod>(defaultStatsPeriod)

  const nav: VltraNav = {
    screen: place.screen,
    project: place.project,
    period,
    href: (target, filter) => {
      const to = moveTo(place, target, filter)

      return vltraHref(to.screen, { project: to.project, session: selected, period })
    },
    show: (target, filter) => {
      const to = moveTo(place, target, filter)

      if (to.screen === place.screen && to.project === place.project) return

      navigations.push({ kind: 'show', screen: to.screen, project: to.project })
      setPlace(to)

      // Like the URL: Stats' range stays only while Stats shows.
      if (to.screen !== place.screen) setPeriod(defaultStatsPeriod)
    },
    setProject: filter => {
      navigations.push({ kind: 'filter', project: filter })
      setPlace({ screen: place.screen, project: filter })
    },
    setPeriod: next => {
      navigations.push({ kind: 'period', period: next })
      setPeriod(next)
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
    <VltraActionsProvider actions={actions}>
      <VltraShell live={live} stream="live" now={now} selection={selection} nav={nav}>
        <CurrentTab />
      </VltraShell>
      <Toaster theme="light" />
      <output
        hidden
        data-location={vltraHref(place.screen, {
          project: place.project,
          session: selected,
          period
        })}
      />
    </VltraActionsProvider>
  )
}

/** The URL a rendered `TestDashboard` stands for. */
export const testLocation = () =>
  document.querySelector('output[data-location]')?.getAttribute('data-location')
