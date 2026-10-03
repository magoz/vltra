'use client'

import { useEffect, useMemo } from 'react'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { FleetBoard } from '@/app/fleet-board'
import { FleetHeader } from '@/app/fleet-header'
import { interruptSessionAction } from '@/app/interrupt-session-action'
import { markHandledAction } from '@/app/mark-handled-action'
import { markViewedAction } from '@/app/mark-viewed-action'
import { replyFormAction } from '@/app/reply-form-action'
import { replyPermissionAction } from '@/app/reply-permission-action'
import { reopenAction } from '@/app/reopen-action'
import { sendPromptAction } from '@/app/send-prompt-action'
import { SessionPanel } from '@/app/session-panel'
import { useFleetLive } from '@/app/use-fleet-live'
import { useNow } from '@/app/use-now'
import { useSelectedSession } from '@/app/use-selected-session'
import { Toaster } from '@/components/ui/sonner'
import { boardRow, buildBoard } from '@/lib/data/fleet/board'
import type { FleetSnapshot } from '@/lib/data/fleet/types'

const serverActions: FleetActions = {
  markHandled: markHandledAction,
  reopen: reopenAction,
  markViewed: markViewedAction,
  replyPermission: replyPermissionAction,
  replyForm: replyFormAction,
  sendPrompt: sendPromptAction,
  interrupt: interruptSessionAction
}

/**
 * The live dashboard: header counts and connection, the attention board, and the session
 * panel (side panel from `lg`, full screen below it). Seeded with the server's snapshot, then kept
 * live from the event stream.
 */
export function FleetDashboard({ initial }: { readonly initial: FleetSnapshot }) {
  const { live, stream } = useFleetLive(initial)
  const now = useNow(initial.generatedAt)
  const { selected, select, close } = useSelectedSession()
  const board = useMemo(() => buildBoard(live, now), [live, now])
  const selectedRow = selected === undefined ? undefined : live.rows.get(selected)
  const selectedItem = selectedRow === undefined ? undefined : boardRow(live, selectedRow)

  useEffect(() => {
    if (selected === undefined) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) close()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [selected, close])

  return (
    <FleetActionsProvider actions={serverActions}>
      <div className="flex min-h-dvh flex-col font-mono text-sm">
        <FleetHeader counts={board.counts} stream={stream} connection={live.connection} />
        <div className="flex-1 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section aria-label="Sessions" className="min-w-0">
            <FleetBoard board={board} now={now} selection={{ selected, onSelect: select }} />
          </section>
          {selected === undefined ? (
            <aside
              aria-label="Session"
              className="text-muted-foreground border-l px-4 py-6 max-lg:hidden lg:sticky lg:top-12 lg:h-[calc(100dvh-3rem)]"
            >
              Select a session to see its last messages, changed files and follow-up box.
            </aside>
          ) : (
            <aside
              aria-label="Session"
              className="bg-background max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:overflow-y-auto max-lg:overscroll-contain lg:sticky lg:top-12 lg:h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:border-l"
            >
              <SessionPanel
                key={selected}
                sessionID={selected}
                item={selectedItem}
                now={now}
                onClose={close}
              />
            </aside>
          )}
        </div>
        <Toaster position="bottom-center" />
      </div>
    </FleetActionsProvider>
  )
}
