import { Skeleton } from '@/components/ui/skeleton'

const sections = [
  { id: 'first', rows: ['a', 'b'] },
  { id: 'second', rows: ['c', 'd', 'e'] }
]

/**
 * The dashboard's prerendered stand-in (part of the static shell): the same header bar and
 * two-column frame, with skeleton counts and rows.
 */
export function FleetDashboardSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col font-mono text-sm" aria-busy="true">
      <header className="sticky top-0 z-20 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3 lg:h-12">
        <h1 className="text-base font-semibold">Fleet</h1>
        <Skeleton className="h-4 w-56" />
      </header>
      <div className="flex-1 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div aria-label="Loading sessions">
          {sections.map(section => (
            <div key={section.id}>
              <div className="px-4 pt-4 pb-1.5">
                <Skeleton className="h-3 w-24" />
              </div>
              <ul>
                {section.rows.map(row => (
                  <li
                    key={row}
                    className="border-hairline grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 border-t py-3 pr-4 pl-3.5 md:py-2.5"
                  >
                    <Skeleton className="mt-1 size-2.5 rounded-none" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="col-start-2 h-3 w-1/2" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-l max-lg:hidden" />
      </div>
    </div>
  )
}
