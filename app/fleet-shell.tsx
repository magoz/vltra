'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useFleetActions } from '@/app/fleet-actions'
import { FleetProvider } from '@/app/fleet-context'
import type { FleetNav, SessionSelection } from '@/app/fleet-context'
import { BottomTabs, FleetHeader } from '@/app/fleet-header'
import { SessionPanel } from '@/app/session-panel'
import type { StreamStatus } from '@/app/use-fleet-live'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { useKeys } from '@/app/use-keys'
import { boardRow, withOverrides } from '@/lib/data/fleet/board'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { countRows } from '@/lib/data/fleet/state'

/**
 * Around both pages (DESIGN.md "Clients" → Web): the header (tabs, count line, key hint,
 * connection), the phone's bottom tab bar, Handled / Undo / Reopen, and the session drawer
 * (`?session=`, right side on desktop, full screen on the phone) over either page. Keys: `1` / `2`
 * switch pages, `Escape` closes the drawer.
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

  useKeys({
    '1': nav.page === 'agents' ? undefined : () => nav.go('agents'),
    '2': nav.page === 'projects' ? undefined : () => nav.go('projects'),
    Escape: selected === undefined ? undefined : selection.close
  })

  return (
    <FleetProvider fleet={fleet}>
      <HandledProvider flow={flow}>
        <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh">
          <FleetHeader
            page={nav.page}
            counts={counts}
            stream={stream}
            connection={live.connection}
          />
          <main className="flex min-h-0 flex-1 flex-col max-lg:pb-14">{children}</main>
          <BottomTabs page={nav.page} />
          {selected === undefined ? null : (
            <aside
              aria-label="Session"
              className="bg-background fixed z-30 overflow-y-auto overscroll-contain max-lg:inset-0 lg:top-12 lg:right-0 lg:bottom-0 lg:w-[min(44rem,48vw)] lg:border-l"
            >
              <SessionPanel
                key={selected}
                sessionID={selected}
                item={selectedItem}
                now={now}
                onClose={selection.close}
              />
            </aside>
          )}
        </div>
      </HandledProvider>
    </FleetProvider>
  )
}
