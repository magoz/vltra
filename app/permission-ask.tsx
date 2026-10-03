'use client'

import { Predicate } from 'effect'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { permissionTarget } from '@/app/fleet-format'
import { useFleetActions } from '@/app/fleet-actions'
import { Button } from '@/components/ui/button'
import type { PendingPermission } from '@/lib/data/fleet/types'

type Decision = 'once' | 'always' | 'reject'

const decisionNames: Readonly<Record<Decision, string>> = {
  once: 'Allowed once',
  always: 'Always allowed',
  reject: 'Denied'
}

/** A pending permission, answered inline: Allow once, Always, or Deny. */
export function PermissionAsk({
  permission,
  subagent
}: {
  readonly permission: PendingPermission
  /** Set when the request comes from a subagent of this row (its agent, else its title). */
  readonly subagent?: string | undefined
}) {
  const actions = useFleetActions()
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState<Decision>()

  const reply = (decision: Decision) =>
    startTransition(async () => {
      const result = await actions.replyPermission({
        sessionID: permission.sessionID,
        requestID: permission.id,
        decision
      })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not reply to the permission: ${result.message}`)

        return
      }

      // Safe optimism: the request is settled in OpenCode; the row updates from the stream.
      setSent(decision)
    })

  return (
    <div className="space-y-2" data-slot="permission-ask">
      <p className="break-words">
        <span className="text-muted-foreground mr-2 text-xs tracking-wider uppercase">
          Permission
        </span>
        {subagent === undefined ? null : (
          <span className="text-muted-foreground">subagent {subagent} asks: </span>
        )}
        {permission.action} wants{' '}
        <code className="text-foreground">{permissionTarget(permission)}</code>
      </p>
      {permission.message === undefined ? null : (
        <p className="text-muted-foreground break-words">{permission.message}</p>
      )}
      {sent === undefined ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => reply('once')}>
            Allow once
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => reply('always')}>
            Always
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => reply('reject')}>
            Deny
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground" role="status">
          {decisionNames[sent]}
        </p>
      )}
    </div>
  )
}
