'use client'

import { useHandled } from '@/app/use-handled'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * `✔ Done`: marks a finished session's latest run handled (shown as "Done"); the toast that
 * follows offers Undo. Outlined; the check and the verb make it read as a button.
 */
export function HandledButton({
  sessionID,
  variant = 'outline',
  size = 'default',
  className
}: {
  readonly sessionID: string
  readonly variant?: 'solid' | 'outline'
  readonly size?: 'default' | 'sm'
  readonly className?: string
}) {
  const { markHandled } = useHandled()

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      title="Mark done (h, ⌘D)"
      onClick={() => markHandled(sessionID)}
    >
      <span aria-hidden="true">✔</span>
      Done
    </Button>
  )
}

/** Removes the handled marker, so the session's latest run needs me again. */
export function ReopenButton({
  sessionID,
  size = 'default',
  className
}: {
  readonly sessionID: string
  readonly size?: 'default' | 'sm'
  readonly className?: string
}) {
  const { reopen } = useHandled()

  return (
    <Button
      variant="outline"
      size={size}
      className={cn('relative z-10', className)}
      onClick={() => reopen(sessionID)}
    >
      Reopen
    </Button>
  )
}
