'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useFleetActions } from '@/app/fleet-actions'
import { FleetProvider } from '@/app/fleet-context'
import type { FleetNav, SessionSelection } from '@/app/fleet-context'
import { BottomTabs, FleetHeader } from '@/app/fleet-header'
import { SessionDrawer } from '@/app/session-panel'
import { useDrawerTab } from '@/app/use-drawer-tab'
import type { StreamStatus } from '@/app/use-fleet-live'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { useKeys } from '@/app/use-keys'
import { boardRow, withOverrides } from '@/lib/data/fleet/board'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { countRows } from '@/lib/data/fleet/state'

/**
 * Around both pages (DESIGN.md "Clients" → Web): the header (tabs, the Agents mode toggle, count
 * line, key hint, connection), the phone's bottom tab bar, Handled / Undo / Reopen, and the
 * session drawer (`?session=`, right side on desktop, full screen on the phone) over Projects and
 * the Agents board, with its Summary | Chat tabs (the last choice remembered per browser; wider
 * on desktop for Chat). Focus mode shows the session inline instead (`agents-focus.tsx`, which
 * also owns its `c`). Keys: `1` / `2` switch pages, `b` the Agents mode, `Escape` closes the
 * session, `c` toggles the drawer's Summary / Chat.
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
  const selectedRow = selected === undefined ? undefined : view.rows.get(selected)
  const selectedItem = selectedRow === undefined ? undefined : boardRow(view, selectedRow)
  const drawer = useDrawerTab()
  const agents = nav.page === 'agents'
  // Focus mode shows the open session inline, so there is no drawer.
  const inline = agents && nav.view === 'focus'

  useKeys({
    '1': agents ? undefined : () => nav.go('agents'),
    '2': nav.page === 'projects' ? undefined : () => nav.go('projects'),
    b: agents ? () => nav.setView(nav.view === 'board' ? 'focus' : 'board') : undefined,
    Escape: selected === undefined ? undefined : selection.close,
    c:
      selected === undefined || inline
        ? undefined
        : () => drawer.choose(drawer.tab === 'chat' ? 'summary' : 'chat')
  })

  return (
    <FleetProvider fleet={fleet}>
      <HandledProvider flow={flow}>
        <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh">
          <FleetHeader
            page={nav.page}
            view={nav.view}
            counts={counts}
            stream={stream}
            connection={live.connection}
          />
          <main className="flex min-h-0 flex-1 flex-col max-lg:pb-14">{children}</main>
          <BottomTabs page={nav.page} />
          {selected === undefined || inline ? null : (
            <SessionDrawer
              key={selected}
              sessionID={selected}
              item={selectedItem}
              now={now}
              tab={drawer.tab}
              onTab={drawer.choose}
              onClose={selection.close}
            />
          )}
        </div>
      </HandledProvider>
    </FleetProvider>
  )
}
