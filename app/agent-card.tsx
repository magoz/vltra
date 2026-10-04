'use client'

import { useEffect, useRef } from 'react'
import { sessionTitle, stuckText } from '@/app/fleet-format'
import { useFleet } from '@/app/fleet-context'
import { HandledButton, ReopenButton } from '@/app/handled-button'
import { Age, FactLine, GoneLabel, isReopenable, RowLink } from '@/app/session-row'
import { StateMarker } from '@/app/state-marker'
import { useHandled } from '@/app/use-handled'
import { useSwipeLeft } from '@/app/use-swipe'
import type { BoardRow } from '@/lib/data/fleet/board'
import type { FleetRow } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

/**
 * What a card says beyond its title, if anything: why a working run looks stuck
 * (`retrying (n×, …)`, `quiet Nm`), and a deleted folder.
 */
function Flags({ row, now }: { readonly row: FleetRow; readonly now: number }) {
  const stuck = row.state === 'working' ? stuckText(row, now) : undefined

  if (stuck === undefined && !row.gone) return null

  return (
    <FactLine>
      {stuck === undefined ? null : <span className="text-destructive">{stuck}</span>}
      {row.gone ? <GoneLabel /> : null}
    </FactLine>
  )
}

/**
 * A session's card, on the Agents board and in focus mode's list: marker (red for a failed run),
 * project · worktree, a "blocked" badge on the board (its Need you column holds blocked and
 * finished alike), age and title, the stuck / "folder deleted" flags, then Fleet's own action:
 * Handled when finished (swipe left on a phone does the same), Reopen when handled. Asks,
 * answers and activity are left to the chat. `cursor` is the keyboard focus. `compact` is focus
 * mode's list row: no box of its own, a hairline under it, tighter spacing, and the open session
 * tinted.
 */
export function AgentCard({
  item,
  cursor,
  compact = false
}: {
  readonly item: BoardRow
  readonly cursor: boolean
  readonly compact?: boolean
}) {
  const { row } = item
  const { now, selection } = useFleet()
  const { markHandled } = useHandled()
  const finished = row.state === 'finished'
  const swipe = useSwipeLeft(finished ? () => markHandled(row.id) : undefined)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (cursor) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor])

  return (
    <li
      ref={ref}
      data-session={row.id}
      data-state={row.state}
      data-cursor={cursor}
      className="relative shrink-0 overflow-hidden"
    >
      {swipe.offset === 0 ? null : (
        <div
          aria-hidden="true"
          className="bg-attention/15 text-attention absolute inset-0 flex items-center justify-end pr-5 font-semibold"
        >
          Handled
        </div>
      )}
      <div
        {...swipe.handlers}
        style={swipe.style}
        data-selected={row.id === selection.selected}
        data-cursor={cursor}
        className={cn(
          'bg-background data-[selected=true]:border-l-attention lg:data-[cursor=true]:outline-attention relative flex flex-col lg:data-[cursor=true]:outline lg:data-[cursor=true]:-outline-offset-1',
          compact
            ? 'hover:bg-accent/40 data-[selected=true]:bg-accent/60 gap-1 border-b border-l-2 border-l-transparent py-2 pr-3 pl-2.5'
            : 'hover:border-foreground/40 gap-1.5 border px-3 py-2.5 data-[selected=true]:border-l-2 data-[selected=true]:pl-[11px]',
          finished && 'touch-pan-y',
          swipe.offset === 0 && 'transition-transform'
        )}
      >
        <div className="text-muted-foreground flex items-baseline gap-2 text-xs">
          <StateMarker
            state={row.state}
            failed={row.outcome === 'failed'}
            className="shrink-0 translate-y-px self-center"
          />
          <span className="min-w-0 flex-1 truncate">
            {item.project}
            {item.worktree === undefined ? null : ` · ${item.worktree}`}
          </span>
          {row.state === 'blocked' && !compact ? (
            <span className="border-attention text-attention shrink-0 border px-1">blocked</span>
          ) : null}
          <Age row={row} now={now} />
        </div>
        <RowLink
          row={row}
          className={cn('break-words', row.state === 'handled' ? undefined : 'font-semibold')}
        >
          {sessionTitle(row)}
        </RowLink>
        <Flags row={row} now={now} />
        {finished ? (
          <div className="relative z-10 mt-0.5 flex flex-wrap gap-2">
            <HandledButton sessionID={row.id} />
          </div>
        ) : null}
        {isReopenable(row) ? (
          <div className="flex">
            <ReopenButton sessionID={row.id} size="sm" />
          </div>
        ) : null}
      </div>
    </li>
  )
}
