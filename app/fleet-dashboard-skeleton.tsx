import Link from 'next/link'
import { fleetHref } from '@/app/fleet-href'
import type { FleetScreen } from '@/app/fleet-href'
import { Skeleton } from '@/components/ui/skeleton'

/** The tabs (header and phone tab bar): Focus, Agents (the board), Projects. */
const tabs: ReadonlyArray<{ readonly screen: FleetScreen; readonly label: string }> = [
  { screen: 'focus', label: 'Focus' },
  { screen: 'agents', label: 'Agents' },
  { screen: 'projects', label: 'Projects' }
]

/** Focus mode's list: a few blocked rows, then finished ones. */
const sections = [
  { id: 'blocked', rows: ['a', 'b'] },
  { id: 'finished', rows: ['c', 'd', 'e'] }
]

/** Agents in focus mode: the needs-me sidebar and a quiet right side. */
function AgentsSkeleton() {
  return (
    <div aria-label="Loading sessions" className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex flex-col lg:w-[26rem] lg:shrink-0 lg:border-r">
        <div className="px-3 pt-3">
          <Skeleton className="h-7 w-44" />
        </div>
        {sections.map(section => (
          <div key={section.id} className="pt-3">
            <div className="px-3 pb-1.5">
              <Skeleton className="h-3 w-16" />
            </div>
            <ul className="border-t">
              {section.rows.map(row => (
                <li key={row} className="flex flex-col gap-2 border-b py-2 pr-3 pl-3">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-7 w-20" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center max-lg:hidden">
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  )
}

/**
 * The dashboard's prerendered stand-in (the one page's static shell): the same desktop header and
 * phone tab bar with working tabs, and Focus' frame. The prerender cannot see `?view=`, so Agents
 * and Projects show it too, Focus marked, until the live tab replaces it.
 */
export function FleetDashboardSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh" aria-busy="true">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-x-4 border-b px-4 max-lg:hidden">
        <h1 className="text-base font-semibold">Fleet</h1>
        <nav aria-label="Pages" className="flex self-stretch">
          {tabs.map(item => (
            <Link
              key={item.screen}
              href={fleetHref(item.screen, {})}
              aria-current={item.screen === 'focus' ? 'page' : undefined}
              className="text-muted-foreground aria-[current=page]:border-b-foreground aria-[current=page]:text-foreground flex items-center border-b-2 border-b-transparent px-3"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Skeleton className="mr-auto h-3.5 w-64" />
        <Skeleton className="h-3 w-10" />
      </header>
      <main className="flex min-h-0 flex-1 flex-col max-lg:pb-14">
        <AgentsSkeleton />
      </main>
      <nav
        aria-label="Pages"
        className="bg-background fixed inset-x-0 bottom-0 z-20 flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {tabs.map(item => (
          <Link
            key={item.screen}
            href={fleetHref(item.screen, {})}
            aria-current={item.screen === 'focus' ? 'page' : undefined}
            className="text-muted-foreground aria-[current=page]:border-t-foreground aria-[current=page]:text-foreground -mt-px flex h-12 flex-1 items-center justify-center border-t-2 border-t-transparent"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
