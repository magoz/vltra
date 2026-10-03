'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { pageOf } from '@/app/fleet-href'
import type { FleetPage } from '@/app/fleet-href'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const pages: ReadonlyArray<{
  readonly page: FleetPage
  readonly href: string
  readonly label: string
}> = [
  { page: 'agents', href: '/', label: 'Agents' },
  { page: 'projects', href: '/projects', label: 'Projects' }
]

/** The cards a skeleton column holds (the first two columns need me, so they look fuller). */
const columns = [
  { id: 'blocked', cards: ['a', 'b'] },
  { id: 'finished', cards: ['c', 'd', 'e'] },
  { id: 'working', cards: ['f', 'g'] },
  { id: 'handled', cards: ['h'] }
]

const cards = [
  { id: 'first', sections: [['a', 'b'], ['c']] },
  { id: 'second', sections: [['d', 'e']] },
  { id: 'third', sections: [['f']] }
]

function AgentsSkeleton() {
  return (
    <div aria-label="Loading the board" className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 lg:px-4">
        <Skeleton className="h-7 w-44" />
      </div>
      <Skeleton className="mx-3 mt-2 h-9 lg:hidden" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 py-2 lg:grid lg:grid-cols-4 lg:p-4 lg:pt-3">
        {columns.map((column, index) => (
          <div
            key={column.id}
            className={cn('bg-muted/40 lg:border', index === 0 ? undefined : 'max-lg:hidden')}
          >
            <div className="px-3 pt-2.5 pb-2 max-lg:hidden">
              <Skeleton className="h-3 w-16" />
            </div>
            <ul className="flex flex-col gap-2 px-2 pb-2 max-lg:pt-2">
              {column.cards.map(card => (
                <li key={card} className="bg-background flex flex-col gap-2 border px-3 py-2.5">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-7 w-20" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectsSkeleton() {
  return (
    <div
      aria-label="Loading projects"
      className="grid items-start gap-3 p-3 md:grid-cols-2 lg:p-4 xl:grid-cols-3"
    >
      {cards.map(card => (
        <div key={card.id} className="border pb-2">
          <div className="flex justify-between border-b px-3 py-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          {card.sections.map(rows => (
            <div key={rows.join()} className="px-3 pt-2">
              <Skeleton className="h-3 w-16" />
              {rows.map(row => (
                <div key={row} className="flex items-center gap-2.5 py-2">
                  <Skeleton className="size-2.5 rounded-none" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-6" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * The dashboard's prerendered stand-in (the static shell of both pages): the same header with
 * working page tabs, the phone's tab bar, and the current page's frame (board columns or
 * project cards).
 */
export function FleetDashboardSkeleton() {
  const page = pageOf(usePathname())

  return (
    <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh" aria-busy="true">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 lg:h-12 lg:flex-nowrap lg:py-0">
        <h1 className="text-base font-semibold">Fleet</h1>
        <nav aria-label="Pages" className="flex self-stretch max-lg:hidden">
          {pages.map(item => (
            <Link
              key={item.page}
              href={item.href}
              aria-current={item.page === page ? 'page' : undefined}
              className="text-muted-foreground aria-[current=page]:border-b-foreground aria-[current=page]:text-foreground flex items-center border-b-2 border-b-transparent px-3"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Skeleton className="h-3.5 w-64 max-lg:order-last lg:mr-auto" />
        <Skeleton className="h-3 w-10 max-lg:ml-auto" />
      </header>
      <main className="flex min-h-0 flex-1 flex-col max-lg:pb-14">
        {page === 'projects' ? <ProjectsSkeleton /> : <AgentsSkeleton />}
      </main>
      <nav
        aria-label="Pages"
        className="bg-background fixed inset-x-0 bottom-0 z-20 flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {pages.map(item => (
          <Link
            key={item.page}
            href={item.href}
            aria-current={item.page === page ? 'page' : undefined}
            className="text-muted-foreground aria-[current=page]:border-t-foreground aria-[current=page]:text-foreground -mt-px flex h-12 flex-1 items-center justify-center border-t-2 border-t-transparent"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
