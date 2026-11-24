import type { VltraState } from '@/lib/data/vltra/types'
import { cn } from '@/lib/utils'

const stateNames: Readonly<Record<VltraState, string>> = {
  blocked: 'Blocked',
  working: 'Working',
  finished: 'Finished',
  handled: 'Done'
}

const label = (state: VltraState, failed: boolean, waiting: boolean) => {
  if (failed && state === 'finished') return 'Finished · failed'

  if (waiting && state === 'working') return 'Working · waiting'

  return stateNames[state]
}

/**
 * The state marker from the mock: shape and fill, no icons. Filled green square: blocked;
 * half-filled: working (grey when its agent only waits); small filled: finished (red when the run
 * failed); empty: handled.
 */
export function StateMarker({
  state,
  failed = false,
  waiting = false,
  className
}: {
  readonly state: VltraState
  /** The latest run failed (finished rows get a red mark). */
  readonly failed?: boolean
  /** Working, but its agent only waits (`isWaiting`). */
  readonly waiting?: boolean
  readonly className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label(state, failed, waiting)}
      data-state={state}
      data-failed={failed}
      data-waiting={waiting}
      className={cn(
        'border-muted-foreground relative inline-block size-2.5 shrink-0 border',
        'data-[state=blocked]:border-attention data-[state=blocked]:bg-attention',
        'data-[state=working]:border-foreground data-[state=working]:bg-[linear-gradient(to_right,var(--foreground)_50%,transparent_50%)]',
        'data-[state=working]:data-[waiting=true]:border-muted-foreground data-[state=working]:data-[waiting=true]:bg-[linear-gradient(to_right,var(--muted-foreground)_50%,transparent_50%)]',
        'data-[state=finished]:border-foreground data-[state=finished]:bg-foreground data-[state=finished]:m-0.5 data-[state=finished]:size-1.5',
        'data-[state=finished]:data-[failed=true]:border-destructive data-[state=finished]:data-[failed=true]:bg-destructive',
        className
      )}
    />
  )
}
