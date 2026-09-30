import { Suspense } from 'react'
import { FleetOverview } from '@/app/fleet-overview'
import { FleetOverviewSkeleton } from '@/app/fleet-overview-skeleton'

// Prerendered shell; only the live fleet section is request-time. The real dashboard is stage 2.
export default function Page() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Fleet</h1>
        <p className="text-muted-foreground text-sm">Every OpenCode session on Box.</p>
      </header>
      <section aria-labelledby="fleet-sessions" className="space-y-3">
        <h2 id="fleet-sessions" className="text-lg font-medium">
          Sessions
        </h2>
        <Suspense fallback={<FleetOverviewSkeleton />}>
          <FleetOverview />
        </Suspense>
      </section>
    </main>
  )
}
