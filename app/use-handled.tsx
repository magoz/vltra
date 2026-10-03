'use client'

import { Predicate } from 'effect'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { FleetActionResult } from '@/app/fleet-action-result'
import { settled } from '@/app/fleet-actions'
import type { FleetActions } from '@/app/fleet-actions'
import type { RowOverride } from '@/lib/data/fleet/board'
import type { FleetRow } from '@/lib/data/fleet/types'

/** How long the Handled toast (and its Undo) stays up. */
const undoWindow = 6000

/**
 * Handled, Undo and Reopen for the whole dashboard. Each shows at once (an optimistic override
 * until the server's next word on that row), and Handled raises a toast with Undo. `undo` with no
 * session undoes the last Handled (the `u` key).
 */
export type HandledFlow = {
  readonly overrides: ReadonlyMap<string, RowOverride>
  readonly markHandled: (sessionID: string) => void
  readonly reopen: (sessionID: string) => void
  /** Reopens the given session, or the last one marked handled here; returns its id. */
  readonly undo: (sessionID?: string) => string | undefined
}

const HandledContext = createContext<HandledFlow | undefined>(undefined)

export function HandledProvider({
  flow,
  children
}: {
  readonly flow: HandledFlow
  readonly children: ReactNode
}) {
  return <HandledContext value={flow}>{children}</HandledContext>
}

export function useHandled(): HandledFlow {
  const flow = useContext(HandledContext)

  if (flow === undefined) throw new Error('useHandled needs a HandledProvider')

  return flow
}

const toastID = (sessionID: string) => `handled:${sessionID}`

/** Drops overrides the server has already answered (their row changed or is gone). */
const current = (
  overrides: ReadonlyMap<string, RowOverride>,
  rows: ReadonlyMap<string, FleetRow>
): Map<string, RowOverride> =>
  new Map(Array.from(overrides).filter(([id, override]) => rows.get(id) === override.base))

/** Owns the overrides; `rows` is the live (server) row map the overrides are checked against. */
export function useHandledFlow(
  actions: FleetActions,
  rows: ReadonlyMap<string, FleetRow>
): HandledFlow {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, RowOverride>>(() => new Map())
  const rowsRef = useRef(rows)
  // Mark handled calls in flight, so Undo waits for the write it undoes.
  const handling = useRef(new Map<string, Promise<FleetActionResult>>())
  const last = useRef<string | undefined>(undefined)

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const override = useCallback((sessionID: string, target: RowOverride['target']) => {
    const base = rowsRef.current.get(sessionID)

    setOverrides(previous => {
      const next = current(previous, rowsRef.current)

      if (base !== undefined) next.set(sessionID, { base, target })

      return next
    })

    return base
  }, [])

  const drop = useCallback((sessionID: string, target: RowOverride['target']) => {
    setOverrides(previous => {
      if (previous.get(sessionID)?.target !== target) return previous

      const next = new Map(previous)

      next.delete(sessionID)

      return next
    })
  }, [])

  const reopenAfterHandled = useCallback(
    (sessionID: string, failure: string) => {
      const handled =
        handling.current.get(sessionID) ?? Promise.resolve(FleetActionResult.Success())

      handling.current.delete(sessionID)
      override(sessionID, 'finished')

      handled
        .then(() => settled(actions.reopen({ sessionID })))
        .then(result => {
          if (Predicate.isTagged(result, 'Error')) {
            drop(sessionID, 'finished')
            toast.error(`${failure}: ${result.message}`)
          }
        })
    },
    [actions, override, drop]
  )

  const undo = useCallback(
    (sessionID?: string) => {
      const target = sessionID ?? last.current

      if (target === undefined) return undefined

      if (last.current === target) last.current = undefined

      toast.dismiss(toastID(target))
      reopenAfterHandled(target, 'Could not undo')

      return target
    },
    [reopenAfterHandled]
  )

  const markHandled = useCallback(
    (sessionID: string) => {
      const base = override(sessionID, 'handled')
      const call = settled(actions.markHandled({ sessionID }))

      handling.current.set(sessionID, call)
      last.current = sessionID

      toast('Handled', {
        id: toastID(sessionID),
        description: base?.title ?? sessionID,
        duration: undoWindow,
        action: { label: 'Undo', onClick: () => undo(sessionID) }
      })

      call.then(result => {
        if (!Predicate.isTagged(result, 'Error')) return

        if (handling.current.get(sessionID) === call) handling.current.delete(sessionID)

        if (last.current === sessionID) last.current = undefined

        drop(sessionID, 'handled')
        toast.dismiss(toastID(sessionID))
        toast.error(`Could not mark handled: ${result.message}`)
      })
    },
    [actions, override, drop, undo]
  )

  const reopen = useCallback(
    (sessionID: string) => reopenAfterHandled(sessionID, 'Could not reopen'),
    [reopenAfterHandled]
  )

  return useMemo(
    () => ({ overrides, markHandled, reopen, undo }),
    [overrides, markHandled, reopen, undo]
  )
}
