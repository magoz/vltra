'use client'

import { useState } from 'react'
import { RowLink } from '@/app/session-row'
import { UnsnoozeButton } from '@/app/snooze-dialog'
import { wakeText } from '@/app/snooze-time'
import { sessionTitle } from '@/app/vltra-format'
import { useVltra } from '@/app/vltra-context'
import type { BoardRow } from '@/lib/data/vltra/board'

/**
 * Focus' Snoozed section, at the foot of its list: collapsed to `Snoozed · N` (none: nothing),
 * expanded the sessions out until a day, the soonest first, each with when it comes back and Wake
 * (back now). Clicking one opens it like any row.
 */
export function SnoozedList({ items }: { readonly items: ReadonlyArray<BoardRow> }) {
  const { now } = useVltra()
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <section aria-label="Snoozed" className="mt-3 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="text-muted-foreground hover:text-foreground flex w-full items-baseline justify-between px-3 py-2 text-xs tracking-widest uppercase"
      >
        <span>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> Snoozed
        </span>
        <span className="tabular-nums">{items.length}</span>
      </button>
      {open ? (
        <ul aria-label="Snoozed sessions" className="border-t">
          {items.map(({ row, project }) => (
            <li
              key={row.id}
              data-session={row.id}
              className="hover:bg-accent/40 relative flex items-center gap-2 border-b py-1.5 pr-2 pl-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-muted-foreground truncate text-xs">{project}</span>
                <RowLink row={row} className="text-muted-foreground truncate">
                  {sessionTitle(row)}
                </RowLink>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs">
                {row.snoozedUntil === undefined ? null : wakeText(row.snoozedUntil, now)}
              </span>
              <UnsnoozeButton sessionID={row.id} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
