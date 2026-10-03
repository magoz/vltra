'use client'

import type { ReactNode } from 'react'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { FleetShell } from '@/app/fleet-shell'
import { dismissLaunchAction } from '@/app/dismiss-launch-action'
import { interruptSessionAction } from '@/app/interrupt-session-action'
import { launchAction } from '@/app/launch-action'
import { markHandledAction } from '@/app/mark-handled-action'
import { markViewedAction } from '@/app/mark-viewed-action'
import { openCheckoutAction } from '@/app/open-checkout-action'
import { replyFormAction } from '@/app/reply-form-action'
import { replyPermissionAction } from '@/app/reply-permission-action'
import { reopenAction } from '@/app/reopen-action'
import { retireWorktreeAction } from '@/app/retire-worktree-action'
import { sendPromptAction } from '@/app/send-prompt-action'
import { suggestBranchAction } from '@/app/suggest-branch-action'
import { useFleetLive } from '@/app/use-fleet-live'
import { useFleetNav } from '@/app/use-fleet-nav'
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
  interrupt: interruptSessionAction,
  launch: launchAction,
  dismissLaunch: dismissLaunchAction,
  openCheckout: openCheckoutAction,
  retireWorktree: retireWorktreeAction,
  suggestBranch: suggestBranchAction
}

/**
 * The live dashboard's wiring: the server actions, the event stream, the clock, and the URL (page,
 * project filter, open session) around `FleetShell` and the current page. It lives in the layout
 * both pages share, so switching pages keeps the one event stream and its state. Seeded with the
 * server's snapshot, then kept live.
 */
export function FleetDashboard({
  initial,
  children
}: {
  readonly initial: FleetSnapshot
  readonly children: ReactNode
}) {
  const { live, stream } = useFleetLive(initial)
  const now = useNow(initial.generatedAt)
  const selection = useSelectedSession()
  const nav = useFleetNav()

  return (
    <FleetActionsProvider actions={serverActions}>
      <FleetShell live={live} stream={stream} now={now} selection={selection} nav={nav}>
        {children}
      </FleetShell>
      <Toaster position="bottom-center" offset={{ bottom: 64 }} mobileOffset={{ bottom: 64 }} />
    </FleetActionsProvider>
  )
}
