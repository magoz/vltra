import { Skeleton } from '@/components/ui/skeleton'

const rows = ['first', 'second', 'third', 'fourth']

export function FleetOverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading sessions">
      <Skeleton className="h-5 w-72" />
      <ul className="space-y-2">
        {rows.map(row => (
          <li key={row}>
            <Skeleton className="h-6 w-full" />
          </li>
        ))}
      </ul>
    </div>
  )
}
