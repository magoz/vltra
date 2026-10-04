'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { CommandKey, commandKey, inDialog, isLauncherKey } from '@/app/command-keys'
import { useFleetActions } from '@/app/fleet-actions'
import { FleetProvider } from '@/app/fleet-context'
import type { FleetNav, SessionSelection } from '@/app/fleet-context'
import { BottomTabs, ConnectionLine, FleetHeader } from '@/app/fleet-header'
import { LauncherProvider } from '@/app/launcher-context'
import type { Launcher, LauncherRequest } from '@/app/launcher-context'
import { LauncherDialog } from '@/app/launcher-dialog'
import { ShortcutsDialog } from '@/app/shortcuts-dialog'
import type { StreamStatus } from '@/app/use-fleet-live'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { useFavicon } from '@/app/use-favicon'
import { useKeys } from '@/app/use-keys'
import { useLauncherList } from '@/app/use-launcher-list'
import { useUsage } from '@/app/use-usage'
import { focusList, withOverrides } from '@/lib/data/fleet/board'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { countRows } from '@/lib/data/fleet/state'
import type { Launch } from '@/lib/data/fleet/types'

/** A launch started from this page, opened once ready unless the user moved on meanwhile. */
type AwaitedLaunch = {
  readonly id: string
  readonly seen: boolean
  /** Where the user was when it started: any change means they moved on. */
  readonly selected: string | undefined
  readonly screen: FleetNav['screen']
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

    if (selection.selected !== target.selected || nav.screen !== target.screen) {
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
      awaited.current = { id, seen: false, selected: selection.selected, screen: nav.screen }
    },
    [selection.selected, nav.screen]
  )
}

/** `⌘/` (`isLauncherKey`) opens the launcher from anywhere (in the OpenCode chat too: `forwardChatKeys`). */
function useLauncherShortcut(open: () => void) {
  const latest = useRef(open)

  useEffect(() => {
    latest.current = open
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isLauncherKey(event)) return

      event.preventDefault()
      latest.current()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Fleet's `⌘` chords (`commandKey`) from anywhere, in the OpenCode chat too (`forwardChatKeys`),
 * even while typing; not in a dialog. Always taken, so the browser never acts instead (switching
 * tabs, `⌘D`'s bookmark); `⌘D` itself is the open session panel's (`useDoneKey`), `⌘U` the tab's
 * `u` (`useKeys`).
 */
function useCommandKeys(run: (chord: CommandKey) => void) {
  const latest = useRef(run)

  useEffect(() => {
    latest.current = run
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const chord = commandKey(event)

      if (chord === undefined || inDialog(event)) return

      event.preventDefault()
      latest.current(chord)
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Around the tab showing (DESIGN.md "Clients" → Web): the tabs (Focus | Agents | Projects; in the
 * desktop header with the count line, key hint and connection, or the phone's bottom tab bar,
 * whose only other chrome is a reconnecting line when the link is down) and Handled / Undo /
 * Reopen. Each tab shows the open session (`?session=`) itself: Focus' pane, the board's and
 * Projects' split (`SessionSplit`). Keys: `1` / `2` / `3` the tabs, `b` Focus ↔ Agents, `Escape`
 * closes the session, `n` / `⌘/` open the launcher (its palette, its list for the Projects cards,
 * and the auto-open of a launch started here).
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
  const { screen } = nav
  const agents = screen !== 'projects'
  const launcherList = useLauncherList()
  const usage = useUsage()
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
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

  useFavicon(counts)
  useLauncherShortcut(openLauncher)

  useCommandKeys(
    CommandKey.$match({
      Tab: ({ screen: target }) => nav.show(target),
      Session: ({ index }) => {
        const item = focusList(view)[index]

        if (item === undefined) return

        if (screen === 'focus') {
          selection.select(item.row.id)
        } else {
          nav.openSession(item.row.id)
        }
      },
      Done: () => undefined,
      Undo: () => undefined
    })
  )

  useKeys({
    n: () => openLauncher(),
    '?': () => setShortcutsOpen(true),
    '1': screen === 'focus' ? undefined : () => nav.show('focus'),
    '2': screen === 'agents' ? undefined : () => nav.show('agents'),
    '3': screen === 'projects' ? undefined : () => nav.show('projects'),
    b: agents ? () => nav.show(screen === 'agents' ? 'focus' : 'agents') : undefined,
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
              usage={usage}
              now={now}
              onNew={() => openLauncher()}
              onShortcuts={() => setShortcutsOpen(true)}
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
            <ShortcutsDialog screen={screen} open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          </div>
        </HandledProvider>
      </LauncherProvider>
    </FleetProvider>
  )
}
