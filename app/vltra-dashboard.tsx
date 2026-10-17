'use client'

import type { ReactNode } from 'react'
import type { VltraActions } from '@/app/vltra-actions'
import { VltraActionsProvider } from '@/app/vltra-actions'
import { VltraShell } from '@/app/vltra-shell'
import { deleteProjectAction } from '@/app/delete-project-action'
import { dismissLaunchAction } from '@/app/dismiss-launch-action'
import { launchAction } from '@/app/launch-action'
import { markHandledAction } from '@/app/mark-handled-action'
import { markViewedAction } from '@/app/mark-viewed-action'
import { newSessionAction } from '@/app/new-session-action'
import { removePushDeviceAction } from '@/app/remove-push-device-action'
import { reopenAction } from '@/app/reopen-action'
import { retireWorktreeAction } from '@/app/retire-worktree-action'
import { savePushDeviceAction } from '@/app/save-push-device-action'
import { suggestBranchAction } from '@/app/suggest-branch-action'
import { testPushAction } from '@/app/test-push-action'
import { useVltraLive } from '@/app/use-vltra-live'
import { useVltraNav } from '@/app/use-vltra-nav'
import { useNow } from '@/app/use-now'
import { useReloadOnDeploy } from '@/app/use-reload-on-deploy'
import { useSelectedSession } from '@/app/use-selected-session'
import { Toaster } from '@/components/ui/sonner'
import type { VltraSnapshot } from '@/lib/data/vltra/types'

const serverActions: VltraActions = {
  markHandled: markHandledAction,
  reopen: reopenAction,
  markViewed: markViewedAction,
  launch: launchAction,
  dismissLaunch: dismissLaunchAction,
  newSession: newSessionAction,
  retireWorktree: retireWorktreeAction,
  deleteProject: deleteProjectAction,
  suggestBranch: suggestBranchAction,
  savePushDevice: savePushDeviceAction,
  removePushDevice: removePushDeviceAction,
  testPush: testPushAction
}

/**
 * The live dashboard's wiring: the server actions, the event stream, the clock, and the URL (page,
 * project filter, open session) around `VltraShell` and the current page. It lives in the layout
 * both pages share, so switching pages keeps the one event stream and its state. Seeded with the
 * server's snapshot, then kept live.
 */
export function VltraDashboard({
  initial,
  build,
  children
}: {
  readonly initial: VltraSnapshot
  /** The server build that rendered this page (`useReloadOnDeploy`). */
  readonly build: string
  readonly children: ReactNode
}) {
  const { live, stream } = useVltraLive(initial)

  useReloadOnDeploy(build, stream)
  const now = useNow(initial.generatedAt)
  const selection = useSelectedSession()
  const nav = useVltraNav()

  return (
    <VltraActionsProvider actions={serverActions}>
      <VltraShell live={live} stream={stream} now={now} selection={selection} nav={nav}>
        {children}
      </VltraShell>
      {/* Top right below the desktop header; phones (under 600px) get them across the top. */}
      <Toaster
        position="top-right"
        offset={{ top: 60, right: 16 }}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 12px)', left: 12, right: 12 }}
      />
    </VltraActionsProvider>
  )
}
