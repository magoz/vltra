import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { FleetDashboardSkeleton } from '@/app/fleet-dashboard-skeleton'
import { FleetLive } from '@/app/fleet-live'

// Both pages (Agents `/`, Projects `/projects`) render inside one live client tree: the layout
// holds it, so a page switch keeps the event stream, the clock and Handled's undo state, and only
// the (static) page segment changes. The tree is the request-time boundary; its fallback, the
// page's skeleton with the header frame, is the prerendered shell. The watcher read behind it is
// in-memory and returns immediately.
export default function FleetLayout({ children }: { readonly children: ReactNode }) {
  return (
    <Suspense fallback={<FleetDashboardSkeleton />}>
      <FleetLive>{children}</FleetLive>
    </Suspense>
  )
}
