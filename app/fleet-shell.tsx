'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useFleetActions } from '@/app/fleet-actions'
import { FleetProvider, showScreen } from '@/app/fleet-context'
import type { FleetNav, SessionSelection } from '@/app/fleet-context'
import { BottomTabs, ConnectionLine, FleetHeader } from '@/app/fleet-header'
import { screenOf } from '@/app/fleet-href'
import { LauncherProvider } from '@/app/launcher-context'
import type { Launcher, LauncherRequest } from '@/app/launcher-context'
import { LauncherDialog } from '@/app/launcher-dialog'
import { SessionDrawer } from '@/app/session-panel'
import type { StreamStatus } from '@/app/use-fleet-live'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { useKeys } from '@/app/use-keys'
import { useLauncherList } from '@/app/use-launcher-list'
import { usePanelSession } from '@/app/use-panel-session'
import { boardRow, withOverrides } from '@/lib/data/fleet/board'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { countRows } from '@/lib/data/fleet/state'
import type { Launch } from '@/lib/data/fleet/types'

/** A launch started from this page, opened once ready unless the user moved on meanwhile. */
type AwaitedLaunch = {
  readonly id: string
  readonly seen: boolean
  /** Where the user was when it started: any change means they moved on. */
  readonly selected: string | undefined
  readonly page: FleetNav['page']
  readonly view: FleetNav['view']
}

/**
 * Opens a launch's session when it becomes ready, if the user is still where they started it and
 * has not opened anything else since; otherwise it stays listed to click.
 */
function useLaunchAutoOpen(
  launches: ReadonlyArray<Launch>,
  selection: SessionSelection,
  nav: FleetNav,
  onReady: () => void
) {
  const awaited = useRef<AwaitedLaunch>(undefined)

  useEffect(() => {
    const target = awaited.current

    if (target === undefined) return

    if (
      selection.selected !== target.selected ||
      nav.page !== target.page ||
      nav.view !== target.view
    ) {
      awaited.current = undefined

      return
    }

    const launch = launches.find(item => item.id === target.id)

    if (launch === undefined) {
      // Dismissed or expired after it showed up: nothing to wait for.
      if (target.seen) awaited.current = undefined

      return
    }

    awaited.current = { ...target, seen: true }

    if (launch.status === 'failed') {
      awaited.current = undefined
    } else if (launch.status === 'ready' && launch.sessionID !== undefined) {
      awaited.current = undefined
      nav.openSession(launch.sessionID)
      onReady()
    }
  }, [launches, selection.selected, nav, onReady])

  return useCallback(
    (id: string) => {
      awaited.current = {
        id,
        seen: false,
        selected: selection.selected,
        page: nav.page,
        view: nav.view
      }
    },
    [selection.selected, nav.page, nav.view]
  )
}

/** `⌘K` / `Ctrl+K` opens the launcher from anywhere (outside the OpenCode iframe). */
function useLauncherShortcut(open: () => void) {
  const latest = useRef(open)

  useEffect(() => {
    latest.current = open
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) {
        return
      }

      event.preventDefault()
      latest.current()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Around both pages (DESIGN.md "Clients" → Web): the tabs (Agents | Board | Projects; in the
 * desktop header with the count line, key hint and connection, or the phone's bottom tab bar,
 * whose only other chrome is a reconnecting line when the link is down), Handled / Undo / Reopen,
 * and the session drawer (`?session=`, the session's chat: right side on desktop, full screen on
 * the phone) over Projects and the board. Focus mode shows the session inline instead (`agents-focus.tsx`). Keys:
 * `1` / `2` / `3` the tabs, `b` Agents ↔ Board, `Escape` closes the session, `n` / `⌘K` open the
 * launcher (its palette, its list for the Projects cards, and the auto-open of a launch started
 * here).
 */
export function FleetShell({
  live,
  stream,
  now,
  selection,
  nav,
  children
}: {
  readonly live: LiveFleet
  readonly stream: StreamStatus
  readonly now: number
  readonly selection: SessionSelection
  readonly nav: FleetNav
  readonly children: ReactNode
}) {
  const actions = useFleetActions()
  const flow = useHandledFlow(actions, live.rows)
  const view = useMemo(() => withOverrides(live, flow.overrides), [live, flow.overrides])
  const counts = useMemo(() => countRows(Array.from(view.rows.values()), now), [view, now])
  const fleet = useMemo(() => ({ view, now, selection, nav }), [view, now, selection, nav])
  const { selected } = selection
  // The drawer follows the selection a paint behind when switching sessions (`usePanelSession`).
  const shown = usePanelSession(selected)
  const shownRow = shown === undefined ? undefined : view.rows.get(shown)
  const shownItem = shownRow === undefined ? undefined : boardRow(view, shownRow)
  const screen = screenOf(nav.page, nav.view)
  const agents = nav.page === 'agents'
  // Focus mode shows the open session inline, so there is no drawer.
  const inline = agents && nav.view === 'focus'
  const launcherList = useLauncherList()
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [request, setRequest] = useState<LauncherRequest>({ step: 'pick' })
  const { reload } = launcherList

  const openLauncher = useCallback(
    (next: LauncherRequest = { step: 'pick' }) => {
      setRequest(next)
      setLauncherOpen(true)
      reload()
    },
    [reload]
  )

  const launcher: Launcher = useMemo(
    () => ({ list: launcherList.list, open: openLauncher, reload }),
    [launcherList.list, openLauncher, reload]
  )

  const awaitLaunch = useLaunchAutoOpen(live.launches, selection, nav, reload)

  useLauncherShortcut(openLauncher)

  useKeys({
    n: () => openLauncher(),
    '1': screen === 'focus' ? undefined : () => showScreen(nav, 'focus'),
    '2': screen === 'board' ? undefined : () => showScreen(nav, 'board'),
    '3': screen === 'projects' ? undefined : () => showScreen(nav, 'projects'),
    b: agents ? () => nav.setView(nav.view === 'board' ? 'focus' : 'board') : undefined,
    Escape: selected === undefined ? undefined : selection.close
  })

  return (
    <FleetProvider fleet={fleet}>
      <LauncherProvider launcher={launcher}>
        <HandledProvider flow={flow}>
          <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh">
            <FleetHeader
              screen={screen}
              counts={counts}
              stream={stream}
              connection={live.connection}
              onNew={() => openLauncher()}
            />
            <ConnectionLine stream={stream} connection={live.connection} />
            <main className="flex min-h-0 flex-1 flex-col max-lg:pb-14">{children}</main>
            <BottomTabs screen={screen} onNew={() => openLauncher()} />
            <LauncherDialog
              open={launcherOpen}
              request={request}
              list={launcherList.list}
              onOpenChange={setLauncherOpen}
              onLaunched={(id, branch) => {
                awaitLaunch(id)
                toast(`Provisioning ${branch}…`)
              }}
            />
            {shown === undefined || inline ? null : (
              <SessionDrawer
                key={shown}
                sessionID={shown}
                item={shownItem}
                onClose={selection.close}
              />
            )}
          </div>
        </HandledProvider>
      </LauncherProvider>
    </FleetProvider>
  )
}
