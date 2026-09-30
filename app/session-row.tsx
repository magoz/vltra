'use client'

import type { MouseEvent, ReactNode } from 'react'
import { FormAsk } from '@/app/form-ask'
import { activityText, formatCost, modelName, plural, relativeTime } from '@/app/fleet-format'
import { MarkSeenButton } from '@/app/mark-seen-button'
import { PermissionAsk } from '@/app/permission-ask'
import { StateMarker } from '@/app/state-marker'
import { useSessionSummary } from '@/app/use-session-summary'
import { sessionHref } from '@/app/use-selected-session'
import type { BoardRow } from '@/lib/data/fleet/board'
import { lastActivity } from '@/lib/data/fleet/board'
import type { FleetRow } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

export const sessionTitle = (row: Pick<FleetRow, 'title' | 'id'>) => row.title ?? row.id

/** Plain left click (no modifier): open the panel in place instead of following the link. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/** Secondary facts in one muted line: live activity first, then subagents and cost. */
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

function WorkingFacts({ row }: { readonly row: FleetRow }) {
  return (
    <FactLine>
      <span className="text-foreground min-w-0 break-all">
        {row.activity === undefined ? 'working…' : activityText(row.activity)}
      </span>
      <Extras row={row} />
    </FactLine>
  )
}

function FailedFacts({ row }: { readonly row: FleetRow }) {
  const reason =
    row.retry === undefined
      ? row.running
        ? 'a step failed, still running'
        : 'last run failed'
      : `${row.retry.message} (retry ${row.retry.attempt})`

  return (
    <FactLine>
      <span className="text-destructive min-w-0">{reason}</span>
      <Extras row={row} />
    </FactLine>
  )
}

function DoneFacts({ row }: { readonly row: FleetRow }) {
  const summary = useSessionSummary(row.id, row.idle)
  const changes = summary?.changes

  return (
    <FactLine>
      {summary?.answer === undefined ? (
        <span>{row.outcome === 'interrupted' ? 'interrupted' : 'finished'}</span>
      ) : (
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

/** Pending permissions and forms across the row's subtree, answered inline. */
function NeedsYou({ row }: { readonly row: FleetRow }) {
  const sources = [
    { session: row, subagent: undefined },
    ...row.children.map(child => ({ session: child, subagent: sessionTitle(child) }))
  ]

  return (
    <div className="relative z-10 col-start-2 col-end-4 mt-1 space-y-4">
      {sources.flatMap(({ session, subagent }) => [
        ...session.permissions.map(permission => (
          <PermissionAsk key={permission.id} permission={permission} subagent={subagent} />
        )),
        ...session.forms.map(form => <FormAsk key={form.id} form={form} subagent={subagent} />)
      ])}
    </div>
  )
}

function RowActions({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative z-10 col-start-2 col-end-4 mt-1 flex flex-wrap gap-2">{children}</div>
  )
}

/**
 * One session row: marker, project · worktree · title, age and model, then what the state calls
 * for: inline answers (needs you), the failure, live activity (working), or the answer excerpt
 * (done). The whole row opens the session panel; inline controls sit above that link.
 */
export function SessionRow({
  item,
  now,
  selected,
  onSelect
}: {
  readonly item: BoardRow
  readonly now: number
  readonly selected: boolean
  readonly onSelect: (sessionID: string) => void
}) {
  const { row } = item
  const model = modelName(row.model)

  return (
    <li
      data-selected={selected}
      data-state={row.state}
      className="border-hairline hover:bg-accent/40 data-[selected=true]:border-l-foreground data-[selected=true]:bg-accent/40 relative grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 border-t border-l-2 border-l-transparent py-3 pr-4 pl-3.5 md:py-2.5"
    >
      <StateMarker state={row.state} className="mt-1" />
      <a
        href={sessionHref(row.id)}
        aria-current={selected ? 'true' : undefined}
        onClick={event => {
          if (!isPlainClick(event)) return

          event.preventDefault()
          onSelect(row.id)
        }}
        className="focus-visible:after:ring-ring/50 min-w-0 break-words outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
      >
        <span className="text-muted-foreground">
          {item.project}
          {item.worktree === undefined ? null : ` · ${item.worktree}`}
          <span aria-hidden="true" className="max-md:hidden">
            {' '}
            ·
          </span>
        </span>{' '}
        <span className="font-semibold max-md:block">{sessionTitle(row)}</span>
      </a>
      <span className="text-muted-foreground pt-0.5 text-xs whitespace-nowrap">
        <time dateTime={new Date(lastActivity(row)).toISOString()}>
          {relativeTime(lastActivity(row), now)}
        </time>
        {model === undefined ? null : <span className="max-md:hidden"> · {model}</span>}
      </span>
      {row.state === 'needs-you' ? <NeedsYou row={row} /> : null}
      {row.state === 'failed' ? <FailedFacts row={row} /> : null}
      {row.state === 'working' ? <WorkingFacts row={row} /> : null}
      {row.state === 'done' ? <DoneFacts row={row} /> : null}
      {(row.state === 'done' || row.state === 'failed') && row.unseen ? (
        <RowActions>
          <MarkSeenButton sessionID={row.id} />
        </RowActions>
      ) : null}
    </li>
  )
}

/** A compact idle row: title and age only. */
export function IdleRow({
  item,
  now,
  selected,
  onSelect
}: {
  readonly item: BoardRow
  readonly now: number
  readonly selected: boolean
  readonly onSelect: (sessionID: string) => void
}) {
  const { row } = item

  return (
    <li
      data-selected={selected}
      className={cn(
        'hover:bg-accent/40 relative flex items-baseline justify-between gap-3 py-2 pr-4 pl-10 md:py-1',
        selected && 'bg-accent/40'
      )}
    >
      <a
        href={sessionHref(row.id)}
        aria-current={selected ? 'true' : undefined}
        onClick={event => {
          if (!isPlainClick(event)) return

          event.preventDefault()
          onSelect(row.id)
        }}
        className="focus-visible:after:ring-ring/50 min-w-0 truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
      >
        {sessionTitle(row)}
      </a>
      <time
        dateTime={new Date(lastActivity(row)).toISOString()}
        className="text-muted-foreground shrink-0 text-xs"
      >
        {relativeTime(lastActivity(row), now)}
      </time>
    </li>
  )
}
