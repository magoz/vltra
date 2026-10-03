'use client'

import { Predicate } from 'effect'
import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { permissionTarget } from '@/app/fleet-format'
import type { PendingPermission } from '@/lib/data/fleet/types'

/**
 * The `a` / `d` keys: allow once or deny a permission, with a toast either way. Each permission
 * is answered once, so a repeated key does not send twice (unless the reply failed).
 */
export function usePermissionReply() {
  const actions = useFleetActions()
  const answered = useRef(new Set<string>())

  return useCallback(
    (permission: PendingPermission | undefined, decision: 'once' | 'reject') => {
      if (permission === undefined || answered.current.has(permission.id)) return

      answered.current.add(permission.id)

      settled(
        actions.replyPermission({
          sessionID: permission.sessionID,
          requestID: permission.id,
          decision
        })
      ).then(result => {
        if (Predicate.isTagged(result, 'Error')) {
          answered.current.delete(permission.id)
          toast.error(`Could not reply to the permission: ${result.message}`)

          return
        }

        toast(decision === 'once' ? 'Allowed once' : 'Denied', {
          description: `${permission.action} ${permissionTarget(permission)}`
        })
      })
    },
    [actions]
  )
}
