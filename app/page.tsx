import { Suspense } from 'react'
import { FleetDashboardSkeleton } from '@/app/fleet-dashboard-skeleton'
import { FleetLive } from '@/app/fleet-live'

// The dashboard is one live client tree (counts, list and panel share its state), so the whole of
// it is the request-time boundary. Its fallback, with the title and header frame, is the
// prerendered shell; the watcher read behind it is in-memory and returns immediately.
export default function Page() {
  return (
    <Suspense fallback={<FleetDashboardSkeleton />}>
      <FleetLive />
    </Suspense>
  )
}
