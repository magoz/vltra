import { Effect } from 'effect'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import { FleetDashboard } from '@/app/fleet-dashboard'
import { FleetStore } from '@/lib/data/fleet/store'
import { buildId } from '@/lib/runtime/build-id'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Request-fresh seed for the live dashboard: the watcher's current snapshot, rendered on the
 * server around the current page, then kept live in the browser from `GET /api/fleet/events`;
 * `build` lets the page notice a deploy.
 */
export async function FleetLive({ children }: { readonly children: ReactNode }) {
  await connection()

  const snapshot = await runFleet(
    Effect.flatMap(FleetStore, store => store.snapshot).pipe(Effect.withSpan('page.fleet.live'))
  )

  return (
    <FleetDashboard initial={snapshot} build={await buildId()}>
      {children}
    </FleetDashboard>
  )
}
