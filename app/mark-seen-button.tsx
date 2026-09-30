'use client'

import { Predicate } from 'effect'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useFleetActions } from '@/app/fleet-actions'
import { Button } from '@/components/ui/button'

/** Marks a finished session seen in OpenCode (every client clears it, not just this page). */
export function MarkSeenButton({
  sessionID,
  variant = 'outline'
}: {
  readonly sessionID: string
  readonly variant?: 'outline' | 'default'
}) {
  const actions = useFleetActions()
  const [pending, startTransition] = useTransition()
  const [marked, setMarked] = useState(false)

  const markSeen = () =>
    startTransition(async () => {
      const result = await actions.markSeen({ sessionID })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not mark seen: ${result.message}`)

        return
      }

      setMarked(true)
    })

  return (
    <Button variant={variant} disabled={pending || marked} onClick={markSeen}>
      {marked ? 'Seen' : 'Mark seen'}
    </Button>
  )
}
