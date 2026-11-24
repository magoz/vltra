'use client'

import { Predicate } from 'effect'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { wakeText } from '@/app/snooze-time'
import { VltraActionResult } from '@/app/vltra-action-result'
import { settled } from '@/app/vltra-actions'
import type { VltraActions } from '@/app/vltra-actions'
import type { RowChange, RowOverride } from '@/lib/data/vltra/board'
import type { VltraRow } from '@/lib/data/vltra/types'

/** How long the Done and Snoozed toasts (and their Undo) stay up. */
const undoWindow = 6000

/**
 * Handled, Snooze, Undo and Reopen for the whole dashboard. Each shows at once (an optimistic
 * override until the server's next word on that row), and Handled and Snooze raise a toast with
 * Undo.
 */
export type HandledFlow = {
  readonly overrides: ReadonlyMap<string, RowOverride>
  readonly markHandled: (sessionID: string) => void
  readonly reopen: (sessionID: string) => void
  /** Snooze a finished session until `until` (epoch ms). */
  readonly snooze: (sessionID: string, until: number) => void
  /** Bring a snoozed session back now. */
  readonly unsnooze: (sessionID: string) => void
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
  rows: ReadonlyMap<string, VltraRow>
): Map<string, RowOverride> =>
  new Map(Array.from(overrides).filter(([id, override]) => rows.get(id) === override.base))

/** Owns the overrides; `rows` is the live (server) row map the overrides are checked against. */
export function useHandledFlow(
  actions: VltraActions,
  rows: ReadonlyMap<string, VltraRow>
): HandledFlow {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, RowOverride>>(() => new Map())
  const rowsRef = useRef(rows)
  // Mark handled and snooze calls in flight, so Undo waits for the write it undoes.
  const writing = useRef(new Map<string, Promise<VltraActionResult>>())

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const override = useCallback((sessionID: string, change: RowChange) => {
    const base = rowsRef.current.get(sessionID)

    setOverrides(previous => {
      const next = current(previous, rowsRef.current)

      if (base !== undefined) next.set(sessionID, { ...change, base })

      return next
    })

    return base
  }, [])

  const drop = useCallback((sessionID: string, target: RowChange['target']) => {
    setOverrides(previous => {
      if (previous.get(sessionID)?.target !== target) return previous

      const next = new Map(previous)

      next.delete(sessionID)

      return next
    })
  }, [])

  /** Runs `undoing` once the write it undoes (if any) is done, showing `change` meanwhile. */
  const undoAfterWrite = useCallback(
    (
      sessionID: string,
      change: RowChange,
      undoing: () => Promise<VltraActionResult>,
      failure: string
    ) => {
      const write = writing.current.get(sessionID) ?? Promise.resolve(VltraActionResult.Success())

      writing.current.delete(sessionID)
      override(sessionID, change)

      write
        .then(() => settled(undoing()))
        .then(result => {
          if (Predicate.isTagged(result, 'Error')) {
            drop(sessionID, change.target)
            toast.error(`${failure}: ${result.message}`)
          }
        })
    },
    [override, drop]
  )

  const reopenAfterHandled = useCallback(
    (sessionID: string, failure: string) =>
      undoAfterWrite(
        sessionID,
        { target: 'finished' },
        () => actions.reopen({ sessionID }),
        failure
      ),
    [actions, undoAfterWrite]
  )

  const wakeAfterSnooze = useCallback(
    (sessionID: string, failure: string) =>
      undoAfterWrite(
        sessionID,
        { target: 'awake' },
        () => actions.unsnooze({ sessionID }),
        failure
      ),
    [actions, undoAfterWrite]
  )

  /** Starts a write shown at once as `change`, with a toast whose Undo runs `undoing`. */
  const write = useCallback(
    (input: {
      readonly sessionID: string
      readonly change: RowChange
      readonly call: () => Promise<VltraActionResult>
      readonly title: string
      readonly undoing: (sessionID: string, failure: string) => void
      readonly failure: string
    }) => {
      const { sessionID } = input
      const base = override(sessionID, input.change)
      const call = settled(input.call())

      writing.current.set(sessionID, call)

      toast(input.title, {
        id: toastID(sessionID),
        description: base?.title ?? sessionID,
        duration: undoWindow,
        action: {
          label: 'Undo',
          onClick: () => {
            toast.dismiss(toastID(sessionID))
            input.undoing(sessionID, 'Could not undo')
          }
        }
      })

      call.then(result => {
        if (!Predicate.isTagged(result, 'Error')) return

        if (writing.current.get(sessionID) === call) writing.current.delete(sessionID)

        drop(sessionID, input.change.target)
        toast.dismiss(toastID(sessionID))
        toast.error(`${input.failure}: ${result.message}`)
      })
    },
    [override, drop]
  )

  const markHandled = useCallback(
    (sessionID: string) =>
      write({
        sessionID,
        change: { target: 'handled' },
        call: () => actions.markHandled({ sessionID }),
        title: 'Done',
        undoing: reopenAfterHandled,
        failure: 'Could not mark done'
      }),
    [actions, write, reopenAfterHandled]
  )

  const snooze = useCallback(
    (sessionID: string, until: number) =>
      write({
        sessionID,
        change: { target: 'snoozed', until },
        call: () => actions.snooze({ sessionID, until }),
        title: `Snoozed until ${wakeText(until, Date.now())}`,
        undoing: wakeAfterSnooze,
        failure: 'Could not snooze'
      }),
    [actions, write, wakeAfterSnooze]
  )

  const reopen = useCallback(
    (sessionID: string) => reopenAfterHandled(sessionID, 'Could not reopen'),
    [reopenAfterHandled]
  )

  const unsnooze = useCallback(
    (sessionID: string) => wakeAfterSnooze(sessionID, 'Could not bring it back'),
    [wakeAfterSnooze]
  )

  return useMemo(
    () => ({ overrides, markHandled, reopen, snooze, unsnooze }),
    [overrides, markHandled, reopen, snooze, unsnooze]
  )
}
