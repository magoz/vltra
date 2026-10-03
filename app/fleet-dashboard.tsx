'use client'

import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { FleetView } from '@/app/fleet-view'
import { interruptSessionAction } from '@/app/interrupt-session-action'
import { markHandledAction } from '@/app/mark-handled-action'
import { markViewedAction } from '@/app/mark-viewed-action'
import { replyFormAction } from '@/app/reply-form-action'
import { replyPermissionAction } from '@/app/reply-permission-action'
import { reopenAction } from '@/app/reopen-action'
import { sendPromptAction } from '@/app/send-prompt-action'
import { useFleetLive } from '@/app/use-fleet-live'
import { useNow } from '@/app/use-now'
import { useSelectedSession } from '@/app/use-selected-session'
import { Toaster } from '@/components/ui/sonner'
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
 * The live dashboard's wiring: the server actions, the event stream, the clock and the URL's
 * open session around `FleetView`. Seeded with the server's snapshot, then kept live.
 */
export function FleetDashboard({ initial }: { readonly initial: FleetSnapshot }) {
  const { live, stream } = useFleetLive(initial)
  const now = useNow(initial.generatedAt)
  const selection = useSelectedSession()

  return (
    <FleetActionsProvider actions={serverActions}>
      <FleetView live={live} stream={stream} now={now} selection={selection} />
      <Toaster position="bottom-center" />
    </FleetActionsProvider>
  )
}
