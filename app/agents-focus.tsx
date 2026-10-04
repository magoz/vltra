'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AgentCard } from '@/app/agent-card'
import { useFleet } from '@/app/fleet-context'
import { PendingLaunches } from '@/app/pending-launches'
import { SessionPanel } from '@/app/session-panel'
import { HandledProvider, useHandled } from '@/app/use-handled'
import type { HandledFlow } from '@/app/use-handled'
import { useKeys } from '@/app/use-keys'
import { boardRow, focusList, nextNeedsMe, pendingLaunches } from '@/lib/data/fleet/board'
import type { BoardRow } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

/**
 * Keyboard focus from `j` / `k`: the row's id, where it was in case it leaves, and the open session
 * it was moved under. Opening another session spends it, so the list marks the open session and,
 * only while the keys are in use, this cursor.
 */
type Cursor = { readonly id: string; readonly index: number; readonly under: string | undefined }

/** The cursor's row: its own, or the one now in its place when it left; none without a cursor. */
const resolve = (list: ReadonlyArray<BoardRow>, cursor: Cursor | undefined): number => {
  if (cursor === undefined || list.length === 0) return -1

  const found = list.findIndex(item => item.row.id === cursor.id)

  return found >= 0 ? found : Math.min(cursor.index, list.length - 1)
}

/** The right side with nothing open: a quiet line, desktop only. */
function EmptyPane({ empty }: { readonly empty: boolean }) {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-foreground">
        {empty ? 'Nothing needs you' : 'Pick a session on the left'}
      </p>
      <p className="text-xs">
        {empty ? (
          <>
            Working sessions are on Agents (<kbd className="text-foreground">b</kbd>).
          </>
        ) : (
          <>
            <kbd className="text-foreground">j k</kbd> move ·{' '}
            <kbd className="text-foreground">↵</kbd> open
          </>
        )}
      </p>
    </div>
  )
}

function Focus() {
  const { view, selection } = useFleet()
  const flow = useHandled()
  const list = useMemo(() => focusList(view), [view])
  const launches = useMemo(() => pendingLaunches(view.launches), [view.launches])
  const [moved, setMoved] = useState<Cursor>()
  const { selected } = selection
  const cursor = moved?.under === selected ? moved : undefined
  const index = resolve(list, cursor)
  const focused = list[index]
  const selectedRow = selected === undefined ? undefined : view.rows.get(selected)
  const selectedItem = selectedRow === undefined ? undefined : boardRow(view, selectedRow)

  /**
   * Marks `id` handled; when it is the open session (or `always`, the `h` key), the next needs-me
   * session opens, or nothing (the empty state) once none is left.
   */
  const handle = (id: string, always: boolean) => {
    const next = nextNeedsMe(list, id)
    const open = id === selected

    flow.markHandled(id)

    if (!open && !always) return

    if (next !== undefined) {
      selection.select(next.row.id)
    } else if (open) {
      selection.close()
    }
  }

  const handleRef = useRef(handle)

  useEffect(() => {
    handleRef.current = handle
  })

  // Handled from a row's or the panel's button, or a swipe: the same advance as `h`.
  const advancing: HandledFlow = useMemo(
    () => ({ ...flow, markHandled: id => handleRef.current(id, false) }),
    [flow]
  )

  /** `j` / `k`: from the cursor, else from the open session's row, else onto the first row. */
  const move = (delta: 1 | -1) => {
    const from = index >= 0 ? index : list.findIndex(item => item.row.id === selected)
    const to = from < 0 ? 0 : Math.max(0, Math.min(from + delta, list.length - 1))
    const item = list[to]

    if (item !== undefined) setMoved({ id: item.row.id, index: to, under: selected })
  }

  const handledKey = () => {
    const target = [focused?.row, selectedRow].find(row => row?.state === 'finished')

    if (target !== undefined) handle(target.id, true)
  }

  useKeys({
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    Enter: () => {
      if (focused !== undefined) selection.select(focused.row.id)
    },
    h: handledKey,
    u: () => {
      const id = flow.undo()

      if (id !== undefined) selection.select(id)
    }
  })

  return (
    <HandledProvider flow={advancing}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Need you"
          className="flex flex-col lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r"
        >
          {launches.length === 0 ? null : (
            <section aria-label="Provisioning" className="pt-3">
              <h2 className="text-muted-foreground flex items-baseline justify-between px-3 pb-1.5 text-xs tracking-widest uppercase">
                <span>Provisioning</span>
                <span className="tabular-nums">{launches.length}</span>
              </h2>
              <PendingLaunches launches={launches} compact className="border-t" />
            </section>
          )}
          {list.length === 0 ? null : (
            <ul aria-label="Sessions" className={cn(launches.length > 0 && 'mt-3 border-t')}>
              {list.map(item => (
                <AgentCard
                  key={item.row.id}
                  item={item}
                  cursor={item.row.id === focused?.row.id}
                  compact
                />
              ))}
            </ul>
          )}
          {list.length === 0 ? (
            <p className="text-muted-foreground px-3 py-10 text-center lg:hidden">
              Nothing needs you.
            </p>
          ) : null}
          <div aria-hidden="true" className="h-6 shrink-0" />
        </section>
        <section
          aria-label="Session"
          className={cn(
            'bg-background flex min-h-0 min-w-0 flex-1 flex-col',
            selected === undefined ? 'max-lg:hidden' : 'max-lg:fixed max-lg:inset-0 max-lg:z-30'
          )}
        >
          {selected === undefined ? (
            <EmptyPane empty={list.length === 0} />
          ) : (
            <SessionPanel
              key={selected}
              sessionID={selected}
              item={selectedItem}
              onClose={selection.close}
            />
          )}
        </section>
      </div>
    </HandledProvider>
  )
}

/**
 * Focus (the default tab, DESIGN.md "Clients" → Web): a sidebar listing the launcher's launches
 * ("Provisioning") and, in one list without headings or a filter, the sessions that need me
 * (blocked, longest wait first, badged; then finished, oldest first, with Handled; asks are
 * answered in the chat), and the open session (`?session=`, also
 * one opened from elsewhere) inline in the rest of the page: its chat. Handling the open session
 * opens the next one in list order. The list marks the open session only; `j` / `k` add a cursor
 * until another session opens. Phone: the list; a session opens full screen. Keys: `j`/`k`
 * (`↓`/`↑`) move, `Enter` opens, `h` done (the cursor's finished session, else the open one;
 * the next opens), `u` undo (the shell adds the tabs, `b` board and `Escape` closes).
 */
export function AgentsFocus() {
  return <Focus />
}
