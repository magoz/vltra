'use client'

import { Predicate } from 'effect'
import { useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { useFleet } from '@/app/fleet-context'
import { plural } from '@/app/fleet-format'
import { useLauncher } from '@/app/launcher-context'
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
import { Button } from '@/components/ui/button'
import { busySessions, isWithin } from '@/lib/data/fleet/checkouts'
import { worktreeName } from '@/lib/data/fleet/palette'
import type { LauncherWorktree } from '@/lib/data/fleet/types'

/** Why Retire is disabled: sessions there still work or wait on me. */
export const busyReason = (count: number) =>
  `${count} ${count === 1 ? 'session there is' : 'sessions there are'} working or blocked`

/**
 * Retire for a Fleet/OpenCode (dotfiles-owned) worktree: disabled with the reason while any
 * session there is working or blocked; otherwise a confirmation that says what happens, then
 * OpenCode `worktree.remove` (never forced) with a toast.
 */
export function RetireWorktree({
  projectID,
  worktree
}: {
  readonly projectID: string
  readonly worktree: LauncherWorktree
}) {
  const actions = useFleetActions()
  const launcher = useLauncher()
  const { view } = useFleet()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const reasonID = useId()
  const rows = useMemo(() => Array.from(view.rows.values()), [view])
  const busy = busySessions(rows, worktree.directory).length
  const sessions = rows.filter(row => isWithin(row.directory, worktree.directory)).length
  const name = worktreeName(worktree)

  if (busy > 0) {
    return (
      <span className="flex items-center gap-1.5">
        <span id={reasonID} className="text-muted-foreground" title={busyReason(busy)}>
          <span aria-hidden="true">busy</span>
          <span className="sr-only">{busyReason(busy)}</span>
        </span>
        <Button variant="outline" size="sm" disabled aria-describedby={reasonID}>
          Retire
        </Button>
      </span>
    )
  }

  const retire = () =>
    startTransition(async () => {
      const result = await settled(
        actions.retireWorktree({ projectID, directory: worktree.directory })
      )

      setOpen(false)

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not retire ${name}: ${result.message}`)

        return
      }

      toast.success(`Retired ${name}`)
      launcher.reload()
    })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        Retire
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retire {name}?</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <ul className="list-disc space-y-1 pl-4 text-left">
              <li>
                OpenCode removes the worktree at{' '}
                <span className="break-all">{worktree.directory}</span> through the dotfiles plugin
                (worktree-manage): database leases are released and the checkout is removed, never
                forced.
              </li>
              <li>
                {worktree.branch === undefined
                  ? 'No branch is checked out there.'
                  : `The branch ${worktree.branch} is kept.`}
              </li>
              <li>Refused if the checkout has uncommitted or untracked changes.</li>
              <li>
                {sessions === 0
                  ? 'No sessions ran there.'
                  : `${plural(sessions, 'session', 'sessions')} there become “folder deleted” (handled).`}
              </li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={retire}>
            {pending ? 'Retiring…' : 'Retire'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
