'use client'

import type { MouseEvent, ReactNode } from 'react'
import {
  activityText,
  endText,
  formatCost,
  pendingText,
  plural,
  relativeTime,
  sessionTitle,
  stuckText
} from '@/app/fleet-format'
import { sessionHref, useFleet } from '@/app/fleet-context'
import { ReopenButton } from '@/app/handled-button'
import { StateMarker } from '@/app/state-marker'
import { useSessionSummary } from '@/app/use-session-summary'
import type { BoardRow } from '@/lib/data/fleet/board'
import type { FleetRow } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

// The pieces both pages build sessions from: the link that opens the drawer, the age, and the
// facts each state calls for. Agents cards are in `agent-card.tsx`; Projects rows are below.

/** Plain left click (no modifier): handle it in place instead of following the link. */
export const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/**
 * The session's link: opens the drawer (`?session=`) over the current page; covers its whole
 * card or row (`relative` parent), below the inline controls (`relative z-10`).
 */
export function RowLink({
  row,
  className,
  children
}: {
  readonly row: FleetRow
  readonly className?: string
  readonly children: ReactNode
}) {
  const { nav, selection } = useFleet()

  return (
    <a
      href={sessionHref(nav, row.id)}
      aria-current={row.id === selection.selected ? 'true' : undefined}
      onClick={event => {
        if (!isPlainClick(event)) return

        event.preventDefault()
        selection.select(row.id)
      }}
      className={cn(
        'focus-visible:after:ring-ring/50 min-w-0 outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px] focus-visible:after:ring-inset',
        className
      )}
    >
      {children}
    </a>
  )
}

export function Age({ row, now }: { readonly row: FleetRow; readonly now: number }) {
  return (
    <time dateTime={new Date(row.activeAt).toISOString()}>{relativeTime(row.activeAt, now)}</time>
  )
}

/** Secondary facts in one muted line. */
export function FactLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-x-3.5 gap-y-0.5 break-words">
      {children}
    </div>
  )
}

export function Extras({ row }: { readonly row: FleetRow }) {
  const cost = formatCost(row.cost)

  return (
    <>
      {row.children.length === 0 ? null : (
        <span>{plural(row.children.length, 'subagent', 'subagents')}</span>
      )}
      {cost === undefined ? null : <span>{cost}</span>}
    </>
  )
}

/** How the run ended, when it needs saying: failed (red) or stopped by OpenCode. */
function EndLabel({ row }: { readonly row: FleetRow }) {
  return (
    <span className={row.outcome === 'failed' ? 'text-destructive' : undefined}>
      {endText(row)}
    </span>
  )
}

/** The session's folder was deleted: it counts as handled and cannot be reopened. */
export function GoneLabel() {
  return <span className="text-muted-foreground">folder deleted</span>
}

/** A finished run: how it ended when notable, the answer excerpt, change totals. */
export function FinishedFacts({ row }: { readonly row: FleetRow }) {
  const summary = useSessionSummary(row.id, row.idle)
  const changes = summary?.changes
  const notable = row.outcome === 'failed' || row.interrupt === 'inactivity'

  return (
    <FactLine>
      {notable || summary?.answer === undefined ? <EndLabel row={row} /> : null}
      {summary?.answer === undefined ? null : (
        <span className="text-foreground line-clamp-3 min-w-0 break-words">“{summary.answer}”</span>
      )}
      {changes === undefined || changes.files === 0 ? null : (
        <span className="whitespace-nowrap">
          <span className="text-attention">+{changes.additions}</span>{' '}
          <span className="text-destructive">−{changes.deletions}</span> ·{' '}
          {plural(changes.files, 'file', 'files')}
        </span>
      )}
      <Extras row={row} />
    </FactLine>
  )
}

/** A working run: live activity, stuck labels (`retrying (n×, …)`, `quiet Nm`), extras. */
export function WorkingFacts({ row, now }: { readonly row: FleetRow; readonly now: number }) {
  const stuck = stuckText(row, now)

  return (
    <FactLine>
      <span className="text-foreground min-w-0 break-all">
        {row.activity === undefined ? 'working…' : activityText(row.activity)}
      </span>
      {stuck === undefined ? null : <span className="text-destructive">{stuck}</span>}
      {row.gone ? <GoneLabel /> : null}
      <Extras row={row} />
    </FactLine>
  )
}

/** A handled session can be reopened unless it never ran or its folder is gone. */
export const isReopenable = (row: FleetRow) =>
  row.state === 'handled' && row.handled !== undefined && !row.gone

/** The one-line state label of a Projects row. */
function StateLabel({ row, now }: { readonly row: FleetRow; readonly now: number }) {
  switch (row.state) {
    case 'blocked':
      return <span className="text-attention">blocked · {pendingText(row)}</span>
    case 'working': {
      const stuck = stuckText(row, now)

      return stuck === undefined ? (
        <span>{row.activity === undefined ? 'working' : activityText(row.activity)}</span>
      ) : (
        <span className="text-destructive">{stuck}</span>
      )
    }

    case 'finished':
      return <EndLabel row={row} />
    case 'handled':
      return row.gone ? <GoneLabel /> : <span>handled</span>
  }
}

/**
 * A Projects row: marker, title and age, then where it runs (the directory in Other, the
 * worktree in the handled fold) and its state label. Handled rows offer Reopen.
 */
export function ProjectRow({
  item,
  now,
  place,
  cursor
}: {
  readonly item: BoardRow
  readonly now: number
  /** Directory or worktree to show before the state label. */
  readonly place: string | undefined
  readonly cursor: boolean
}) {
  const { row } = item
  const { selection } = useFleet()
  const handled = row.state === 'handled'

  return (
    <li
      data-session={row.id}
      data-state={row.state}
      data-selected={row.id === selection.selected}
      data-cursor={cursor}
      className="hover:bg-accent/60 data-[selected=true]:border-l-attention data-[selected=true]:bg-accent/60 lg:data-[cursor=true]:bg-accent relative grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 border-l-2 border-l-transparent py-1.5 pr-3 pl-2.5"
    >
      <StateMarker
        state={row.state}
        failed={row.outcome === 'failed'}
        className="translate-y-px self-center"
      />
      <RowLink
        row={row}
        className={cn('break-words', handled ? 'text-muted-foreground' : undefined)}
      >
        {sessionTitle(row)}
      </RowLink>
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        <Age row={row} now={now} />
      </span>
      <span className="text-muted-foreground col-start-2 text-xs break-all">
        {place === undefined ? null : `${place} · `}
        <StateLabel row={row} now={now} />
      </span>
      {isReopenable(row) ? (
        <span className="col-start-3 row-start-2 justify-self-end">
          <ReopenButton sessionID={row.id} size="sm" />
        </span>
      ) : null}
    </li>
  )
}
