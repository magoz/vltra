'use client'

import { Predicate } from 'effect'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { plural } from '@/app/fleet-format'
import { busyReason } from '@/app/retire-worktree'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import type { ProjectCard } from '@/lib/data/fleet/board'
import type { FleetState } from '@/lib/data/fleet/types'

const isBusy = (state: FleetState) => state === 'working' || state === 'blocked'

const triggerClass =
  'text-muted-foreground hover:bg-accent/60 hover:text-destructive focus-visible:ring-ring/50 border-l px-3 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50'

/**
 * Delete for a Projects card: disabled with the reason while any of its sessions is working or
 * blocked; otherwise a confirmation, then `deleteProject` (every session there removed in
 * OpenCode for good) with a toast. The card leaves as the deletions stream in.
 */
export function DeleteProject({ card }: { readonly card: ProjectCard }) {
  const actions = useFleetActions()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const reasonID = useId()
  const active = card.sections.flatMap(section => section.rows)
  const busy = active.filter(item => isBusy(item.row.state)).length
  const sessions = active.length + card.handled.length

  if (busy > 0) {
    return (
      <button
        type="button"
        disabled
        aria-label={`Delete ${card.name}`}
        aria-describedby={reasonID}
        title={busyReason(busy)}
        className={triggerClass}
      >
        Delete
        <span id={reasonID} className="sr-only">
          {busyReason(busy)}
        </span>
      </button>
    )
  }

  const remove = () =>
    startTransition(async () => {
      const result = await settled(actions.deleteProject({ project: card.id }))

      setOpen(false)

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not delete ${card.name}: ${result.message}`)

        return
      }

      toast.success(`Deleted ${card.name}`)
    })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <button type="button" aria-label={`Delete ${card.name}`} className={triggerClass} />
        }
      >
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent className="font-mono">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {card.name}?</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <ul className="list-disc space-y-1 pl-4 text-left">
              <li>
                OpenCode deletes{' '}
                {card.other ? 'every session outside a repository' : 'the project’s sessions'} (
                {plural(sessions, 'session', 'sessions')}, with their messages and subagents) for
                good. This cannot be undone.
              </li>
              <li>Files, folders, worktrees and branches stay as they are.</li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={remove}>
            {pending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
