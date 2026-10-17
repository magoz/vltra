import { Effect } from 'effect'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import { VltraDashboard } from '@/app/vltra-dashboard'
import { VltraStore } from '@/lib/data/vltra/store'
import { buildId } from '@/lib/runtime/build-id'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * Request-fresh seed for the live dashboard: the watcher's current snapshot, rendered on the
 * server around the current page, then kept live in the browser from `GET /api/vltra/events`;
 * `build` lets the page notice a deploy.
 */
export async function VltraLive({ children }: { readonly children: ReactNode }) {
  await connection()

  const snapshot = await runVltra(
    Effect.flatMap(VltraStore, store => store.snapshot).pipe(Effect.withSpan('page.vltra.live'))
  )

  return (
    <VltraDashboard initial={snapshot} build={await buildId()}>
      {children}
    </VltraDashboard>
  )
}
