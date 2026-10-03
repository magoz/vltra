'use client'

import { useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import {
  activityText,
  endText,
  formatCost,
  modelName,
  pendingText,
  plural,
  relativeTime,
  sessionTitle,
  stuckText
} from '@/app/fleet-format'
import { HandledButton, ReopenButton } from '@/app/handled-button'
import { PendingAsks } from '@/app/pending-asks'
import { StateMarker } from '@/app/state-marker'
import { useHandled } from '@/app/use-handled'
import { sessionHref } from '@/app/use-selected-session'
import { useSessionSummary } from '@/app/use-session-summary'
import { useSwipeLeft } from '@/app/use-swipe'
import type { BoardRow } from '@/lib/data/fleet/board'
import type { FleetRow } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

/** Plain left click (no modifier): open the panel in place instead of following the link. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/** The row's link: opens the panel; covers the whole row, below its inline controls. */
function RowLink({
  row,
  selected,
  onSelect,
  className,
  children
}: {
  readonly row: FleetRow
  readonly selected: boolean
  readonly onSelect: (sessionID: string) => void
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <a
      href={sessionHref(row.id)}
      aria-current={selected ? 'true' : undefined}
      onClick={event => {
        if (!isPlainClick(event)) return

        event.preventDefault()
        onSelect(row.id)
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

function Age({ row, now }: { readonly row: FleetRow; readonly now: number }) {
  return (
    <time dateTime={new Date(row.activeAt).toISOString()}>{relativeTime(row.activeAt, now)}</time>
  )
}

/** Secondary facts in one muted line. */
function FactLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="text-muted-foreground col-start-2 col-end-4 flex flex-wrap gap-x-3.5 gap-y-0.5 break-words">
      {children}
    </div>
  )
}

function Extras({ row }: { readonly row: FleetRow }) {
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

function FinishedFacts({ row }: { readonly row: FleetRow }) {
  const summary = useSessionSummary(row.id, row.idle)
  const changes = summary?.changes
  const notable = row.outcome === 'failed' || row.interrupt === 'inactivity'

  return (
    <FactLine>
      {notable || summary?.answer === undefined ? <EndLabel row={row} /> : null}
      {summary?.answer === undefined ? null : (
        <span className="text-foreground line-clamp-2 min-w-0 break-words">“{summary.answer}”</span>
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

/**
 * A sidebar (needs me) row: marker, project · worktree, title and age, then what the state calls
 * for: inline answers (blocked, subagents' requests included), or the answer excerpt, change
 * totals and Handled (finished; swipe left on a phone does the same). `cursor` is the keyboard
 * focus (`j` / `k`).
 */
export function NeedsMeRow({
  item,
  now,
  selected,
  cursor,
  onSelect
}: {
  readonly item: BoardRow
  readonly now: number
  readonly selected: boolean
  readonly cursor: boolean
  readonly onSelect: (sessionID: string) => void
}) {
  const { row } = item
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
      className="border-hairline relative overflow-hidden border-t"
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
        data-selected={selected}
        data-cursor={cursor}
        className={cn(
          'bg-background hover:bg-accent/40 data-[selected=true]:bg-accent/40 data-[selected=true]:border-l-foreground data-[cursor=true]:border-l-attention data-[cursor=true]:bg-accent/60 relative grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 border-l-2 border-l-transparent py-3 pr-4 pl-3.5 md:py-2.5',
          finished && 'touch-pan-y',
          swipe.offset === 0 && 'transition-transform'
        )}
      >
        <StateMarker state={row.state} failed={row.outcome === 'failed'} className="mt-1" />
        <RowLink row={row} selected={selected} onSelect={onSelect} className="break-words">
          <span className="text-muted-foreground block text-xs">
            {item.project}
            {item.worktree === undefined ? null : ` · ${item.worktree}`}
          </span>
          <span className="font-semibold">{sessionTitle(row)}</span>
        </RowLink>
        <span className="text-muted-foreground pt-0.5 text-xs whitespace-nowrap">
          <Age row={row} now={now} />
        </span>
        {row.state === 'blocked' ? (
          <div className="relative z-10 col-start-2 col-end-4 mt-1">
            <PendingAsks row={row} />
          </div>
        ) : null}
        {finished ? <FinishedFacts row={row} /> : null}
        {finished ? (
          <div className="relative z-10 col-start-2 col-end-4 mt-1 flex flex-wrap gap-2">
            <HandledButton sessionID={row.id} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** The facts a Projects row shows for its state. */
function ProjectFacts({ row, now }: { readonly row: FleetRow; readonly now: number }) {
  switch (row.state) {
    case 'blocked':
      return (
        <FactLine>
          <span className="text-attention">needs you · {pendingText(row)}</span>
        </FactLine>
      )
    case 'working': {
      const stuck = stuckText(row, now)

      return (
        <FactLine>
          <span className="text-foreground min-w-0 break-all">
            {row.activity === undefined ? 'working…' : activityText(row.activity)}
          </span>
          {stuck === undefined ? null : <span className="text-destructive">{stuck}</span>}
          <Extras row={row} />
        </FactLine>
      )
    }

    case 'finished':
      return (
        <FactLine>
          <EndLabel row={row} />
        </FactLine>
      )
    case 'handled':
      return null
  }
}

/**
 * A Projects row: marker, title and age, the session's directory in the Other group, then live
 * activity and stuck labels (working), what it waits on (blocked) or how it ended (finished).
 * Handled rows offer Reopen (on hover with a mouse, always on touch).
 */
export function ProjectRow({
  item,
  now,
  selected,
  showDirectory,
  onSelect
}: {
  readonly item: BoardRow
  readonly now: number
  readonly selected: boolean
  readonly showDirectory: boolean
  readonly onSelect: (sessionID: string) => void
}) {
  const { row } = item
  const model = modelName(row.model)
  const reopenable = row.state === 'handled' && row.handled !== undefined

  return (
    <li
      data-session={row.id}
      data-state={row.state}
      data-selected={selected}
      className="group hover:bg-accent/40 data-[selected=true]:border-l-foreground data-[selected=true]:bg-accent/40 relative grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 border-l-2 border-l-transparent py-2 pr-4 pl-3.5 md:py-1.5"
    >
      <StateMarker
        state={row.state}
        failed={row.outcome === 'failed'}
        className="translate-y-px self-center"
      />
      <RowLink
        row={row}
        selected={selected}
        onSelect={onSelect}
        className={cn('truncate', row.state === 'handled' ? undefined : 'font-semibold')}
      >
        {sessionTitle(row)}
      </RowLink>
      <span className="text-muted-foreground flex items-center gap-2 text-xs whitespace-nowrap">
        {reopenable ? (
          <ReopenButton
            sessionID={row.id}
            size="sm"
            className="pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          />
        ) : null}
        <Age row={row} now={now} />
        {model === undefined ? null : <span className="max-md:hidden">{model}</span>}
      </span>
      {showDirectory ? (
        <span className="text-muted-foreground col-start-2 col-end-4 text-xs break-all">
          {row.directory}
        </span>
      ) : null}
      <ProjectFacts row={row} now={now} />
    </li>
  )
}
