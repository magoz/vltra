'use client'

import { useEffect, useRef } from 'react'
import { sessionTitle } from '@/app/fleet-format'
import { useFleet } from '@/app/fleet-context'
import { HandledButton, ReopenButton } from '@/app/handled-button'
import { PendingAsks } from '@/app/pending-asks'
import {
  Age,
  FactLine,
  FinishedFacts,
  GoneLabel,
  isReopenable,
  RowLink,
  WorkingFacts
} from '@/app/session-row'
import { StateMarker } from '@/app/state-marker'
import { useHandled } from '@/app/use-handled'
import { useSwipeLeft } from '@/app/use-swipe'
import type { BoardRow } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

/**
 * A card on the Agents board: marker, project · worktree, title and age, then what its state calls
 * for. Blocked: inline answers (subagents' requests included). Finished: answer excerpt, change
 * totals, failed / stopped-by-OpenCode labels and Handled (swipe left on a phone does the same).
 * Working: live activity and stuck labels. Handled: Reopen, or "folder deleted". `cursor` is the
 * keyboard focus.
 */
export function AgentCard({ item, cursor }: { readonly item: BoardRow; readonly cursor: boolean }) {
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
      className="relative overflow-hidden"
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
          'bg-background hover:border-foreground/40 data-[selected=true]:border-l-attention lg:data-[cursor=true]:outline-attention relative flex flex-col gap-1.5 border border-l-2 px-3 py-2.5 lg:data-[cursor=true]:outline lg:data-[cursor=true]:-outline-offset-1',
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
          <Age row={row} now={now} />
        </div>
        <RowLink
          row={row}
          className={cn('break-words', row.state === 'handled' ? undefined : 'font-semibold')}
        >
          {sessionTitle(row)}
        </RowLink>
        {row.state === 'blocked' ? (
          <div className="relative z-10 mt-1">
            <PendingAsks row={row} />
          </div>
        ) : null}
        {finished ? <FinishedFacts row={row} /> : null}
        {finished ? (
          <div className="relative z-10 mt-0.5 flex flex-wrap gap-2">
            <HandledButton sessionID={row.id} />
          </div>
        ) : null}
        {row.state === 'working' ? <WorkingFacts row={row} now={now} /> : null}
        {row.gone && row.state !== 'working' ? (
          <FactLine>
            <GoneLabel />
          </FactLine>
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
