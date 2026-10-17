import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { VltraDashboardSkeleton } from '@/app/vltra-dashboard-skeleton'
import { VltraLive } from '@/app/vltra-live'

// The dashboard's one page (every tab is `/` plus `?view=`, `app/vltra-href.ts`) renders inside
// one live client tree: the layout holds it, with the event stream, the clock and Handled's undo
// state. The tree is the request-time boundary; its fallback, the skeleton with the header frame,
// is the prerendered shell. The watcher read behind it is in-memory and returns immediately.
export default function VltraLayout({ children }: { readonly children: ReactNode }) {
  return (
    <Suspense fallback={<VltraDashboardSkeleton />}>
      <VltraLive>{children}</VltraLive>
    </Suspense>
  )
}
