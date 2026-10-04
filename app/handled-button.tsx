'use client'

import { useHandled } from '@/app/use-handled'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Marks a finished session's latest run handled; the toast that follows offers Undo. */
export function HandledButton({
  sessionID,
  variant = 'outline',
  size = 'default',
  className
}: {
  readonly sessionID: string
  readonly variant?: 'outline' | 'default'
  readonly size?: 'default' | 'sm'
  readonly className?: string
}) {
  const { markHandled } = useHandled()

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => markHandled(sessionID)}
    >
      Handled
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
