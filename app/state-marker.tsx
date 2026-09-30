import type { FleetState } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

const stateNames: Readonly<Record<FleetState, string>> = {
  'needs-you': 'Needs you',
  failed: 'Failed',
  working: 'Working',
  done: 'Done',
  idle: 'Idle'
}

/**
 * The state marker from the mock: shape and fill, no icons. Filled green square: needs you;
 * filled red: failed; half-filled: working; small filled: done; empty: idle.
 */
export function StateMarker({
  state,
  className
}: {
  readonly state: FleetState
  readonly className?: string
}) {
  return (
    <span
      role="img"
      aria-label={stateNames[state]}
      data-state={state}
      className={cn(
        'border-muted-foreground relative inline-block size-2.5 shrink-0 border',
        'data-[state=needs-you]:border-attention data-[state=needs-you]:bg-attention',
        'data-[state=failed]:border-destructive data-[state=failed]:bg-destructive',
        'data-[state=working]:border-foreground data-[state=working]:bg-[linear-gradient(to_right,var(--foreground)_50%,transparent_50%)]',
        'data-[state=done]:border-foreground data-[state=done]:bg-foreground data-[state=done]:m-0.5 data-[state=done]:size-1.5',
        className
      )}
    />
  )
}
