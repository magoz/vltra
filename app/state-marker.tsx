import type { VltraState } from '@/lib/data/vltra/types'
import { cn } from '@/lib/utils'

const stateNames: Readonly<Record<VltraState, string>> = {
  blocked: 'Blocked',
  working: 'Working',
  finished: 'Finished',
  handled: 'Done'
}

/**
 * The state marker from the mock: shape and fill, no icons. Filled green square: blocked;
 * half-filled: working; small filled: finished (red when the run failed); empty: handled.
 */
export function StateMarker({
  state,
  failed = false,
  className
}: {
  readonly state: VltraState
  /** The latest run failed (finished rows get a red mark). */
  readonly failed?: boolean
  readonly className?: string
}) {
  return (
    <span
      role="img"
      aria-label={failed && state === 'finished' ? 'Finished · failed' : stateNames[state]}
      data-state={state}
      data-failed={failed}
      className={cn(
        'border-muted-foreground relative inline-block size-2.5 shrink-0 border',
        'data-[state=blocked]:border-attention data-[state=blocked]:bg-attention',
        'data-[state=working]:border-foreground data-[state=working]:bg-[linear-gradient(to_right,var(--foreground)_50%,transparent_50%)]',
        'data-[state=finished]:border-foreground data-[state=finished]:bg-foreground data-[state=finished]:m-0.5 data-[state=finished]:size-1.5',
        'data-[state=finished]:data-[failed=true]:border-destructive data-[state=finished]:data-[failed=true]:bg-destructive',
        className
      )}
    />
  )
}
