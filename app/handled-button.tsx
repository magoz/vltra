'use client'

import { Predicate } from 'effect'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useFleetActions } from '@/app/fleet-actions'
import { Button } from '@/components/ui/button'

/** Marks a finished session's latest run handled (stored on the OpenCode session). */
export function HandledButton({
  sessionID,
  variant = 'outline'
}: {
  readonly sessionID: string
  readonly variant?: 'outline' | 'default'
}) {
  const actions = useFleetActions()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  const markHandled = () =>
    startTransition(async () => {
      const result = await actions.markHandled({ sessionID })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not mark handled: ${result.message}`)

        return
      }

      setDone(true)
    })

  return (
    <Button variant={variant} disabled={pending || done} onClick={markHandled}>
      {done ? 'Handled' : 'Mark handled'}
    </Button>
  )
}

/** Removes the handled marker, so the session's latest run needs me again. */
export function ReopenButton({ sessionID }: { readonly sessionID: string }) {
  const actions = useFleetActions()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  const reopen = () =>
    startTransition(async () => {
      const result = await actions.reopen({ sessionID })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not reopen: ${result.message}`)

        return
      }

      setDone(true)
    })

  return (
    <Button variant="outline" disabled={pending || done} onClick={reopen}>
      {done ? 'Reopened' : 'Reopen'}
    </Button>
  )
}
