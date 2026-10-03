import { Effect } from 'effect'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import { FleetDashboard } from '@/app/fleet-dashboard'
import { FleetStore } from '@/lib/data/fleet/store'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Request-fresh seed for the live dashboard: the watcher's current snapshot, rendered on the
 * server around the current page, then kept live in the browser from `GET /api/fleet/events`.
 */
export async function FleetLive({ children }: { readonly children: ReactNode }) {
  await connection()

  const snapshot = await runFleet(
    Effect.flatMap(FleetStore, store => store.snapshot).pipe(Effect.withSpan('page.fleet.live'))
  )

  return <FleetDashboard initial={snapshot}>{children}</FleetDashboard>
}
