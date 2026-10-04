'use client'

import type { ReactNode } from 'react'
import type { FleetActions } from '@/app/fleet-actions'
import { FleetActionsProvider } from '@/app/fleet-actions'
import { FleetShell } from '@/app/fleet-shell'
import { deleteProjectAction } from '@/app/delete-project-action'
import { dismissLaunchAction } from '@/app/dismiss-launch-action'
import { launchAction } from '@/app/launch-action'
import { markHandledAction } from '@/app/mark-handled-action'
import { markViewedAction } from '@/app/mark-viewed-action'
import { newSessionAction } from '@/app/new-session-action'
import { reopenAction } from '@/app/reopen-action'
import { retireWorktreeAction } from '@/app/retire-worktree-action'
import { suggestBranchAction } from '@/app/suggest-branch-action'
import { useFleetLive } from '@/app/use-fleet-live'
import { useFleetNav } from '@/app/use-fleet-nav'
import { useNow } from '@/app/use-now'
import { useReloadOnDeploy } from '@/app/use-reload-on-deploy'
import { useSelectedSession } from '@/app/use-selected-session'
import { Toaster } from '@/components/ui/sonner'
import type { FleetSnapshot } from '@/lib/data/fleet/types'

const serverActions: FleetActions = {
  markHandled: markHandledAction,
  reopen: reopenAction,
  markViewed: markViewedAction,
  launch: launchAction,
  dismissLaunch: dismissLaunchAction,
  newSession: newSessionAction,
  retireWorktree: retireWorktreeAction,
  deleteProject: deleteProjectAction,
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
  build,
  children
}: {
  readonly initial: FleetSnapshot
  /** The server build that rendered this page (`useReloadOnDeploy`). */
  readonly build: string
  readonly children: ReactNode
}) {
  const { live, stream } = useFleetLive(initial)

  useReloadOnDeploy(build, stream)
  const now = useNow(initial.generatedAt)
  const selection = useSelectedSession()
  const nav = useFleetNav()

  return (
    <FleetActionsProvider actions={serverActions}>
      <FleetShell live={live} stream={stream} now={now} selection={selection} nav={nav}>
        {children}
      </FleetShell>
      {/* Top right below the desktop header; phones (under 600px) get them across the top. */}
      <Toaster
        position="top-right"
        offset={{ top: 60, right: 16 }}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 12px)', left: 12, right: 12 }}
      />
    </FleetActionsProvider>
  )
}
