import { Skeleton } from '@/components/ui/skeleton'

const sidebarRows = ['a', 'b', 'c']

const projects = [
  { id: 'first', rows: ['a', 'b', 'c', 'd'] },
  { id: 'second', rows: ['e', 'f'] }
]

/**
 * The dashboard's prerendered stand-in (part of the static shell): the same header and phone
 * tabs, the needs-me sidebar (count line, rows) and Projects (groups of compact rows).
 */
export function FleetDashboardSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh" aria-busy="true">
      <div className="sticky top-0 z-20">
        <header className="flex items-baseline justify-between gap-x-4 border-b px-4 py-3 lg:h-12">
          <h1 className="text-base font-semibold">Fleet</h1>
          <Skeleton className="h-3 w-16 lg:w-80" />
        </header>
        <div className="flex h-11 items-center justify-around border-b lg:hidden">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="flex-1 lg:grid lg:min-h-0 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)]">
        <div aria-label="Loading sessions that need you" className="lg:border-r">
          <div className="border-b px-4 py-3">
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="px-4 pt-4 pb-1.5">
            <Skeleton className="h-3 w-16" />
          </div>
          <ul>
            {sidebarRows.map(row => (
              <li
                key={row}
                className="border-hairline grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 border-t py-3 pr-4 pl-3.5 md:py-2.5"
              >
                <Skeleton className="mt-1 size-2.5 rounded-none" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-8" />
                <Skeleton className="col-start-2 h-4 w-3/4" />
                <Skeleton className="col-start-2 h-7 w-20" />
              </li>
            ))}
          </ul>
        </div>
        <div aria-label="Loading projects" className="max-lg:hidden">
          <div className="px-4 pt-4 pb-1.5">
            <Skeleton className="h-3 w-20" />
          </div>
          {projects.map(project => (
            <div key={project.id} className="border-hairline border-t pt-2 pb-3">
              <div className="px-4 pb-1">
                <Skeleton className="h-4 w-28" />
              </div>
              <ul>
                {project.rows.map(row => (
                  <li
                    key={row}
                    className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 py-2 pr-4 pl-3.5 md:py-1.5"
                  >
                    <Skeleton className="size-2.5 rounded-none" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-8" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
