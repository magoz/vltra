'use client'

import { NeedsMeRow } from '@/app/session-row'
import type { BoardRow } from '@/lib/data/fleet/board'
import type { FleetCounts } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

/** The count line: `4 need you · 17 working · 2 stuck` (needs me = blocked + finished). */
export function CountLine({ counts }: { readonly counts: FleetCounts }) {
  const needMe = counts.blocked + counts.finished

  return (
    <p aria-label="Session counts">
      <span
        className={cn(
          'whitespace-nowrap',
          needMe > 0 ? 'text-attention font-semibold' : 'text-muted-foreground'
        )}
      >
        {needMe} {needMe === 1 ? 'needs you' : 'need you'}
      </span>
      <Separator />
      <span className={cn('whitespace-nowrap', counts.working === 0 && 'text-muted-foreground')}>
        {counts.working} working
      </span>
      <Separator />
      <span
        className={cn(
          'whitespace-nowrap',
          counts.stuck > 0 ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {counts.stuck} stuck
      </span>
    </p>
  )
}

function Separator() {
  return <span className="text-muted-foreground"> · </span>
}

type Selection = {
  readonly selected: string | undefined
  readonly onSelect: (sessionID: string) => void
}

function Group({
  title,
  rows,
  now,
  cursor,
  selection
}: {
  readonly title: string
  readonly rows: ReadonlyArray<BoardRow>
  readonly now: number
  readonly cursor: string | undefined
  readonly selection: Selection
}) {
  if (rows.length === 0) return null

  return (
    <section aria-label={title}>
      <h3 className="text-attention flex justify-between px-4 pt-4 pb-1.5 text-xs tracking-widest uppercase">
        <span>{title}</span>
        <span className="tabular-nums">{rows.length}</span>
      </h3>
      <ul>
        {rows.map(item => (
          <NeedsMeRow
            key={item.row.id}
            item={item}
            now={now}
            selected={item.row.id === selection.selected}
            cursor={item.row.id === cursor}
            onSelect={selection.onSelect}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * The sidebar: the count line, then blocked rows (longest wait first) and finished rows (oldest
 * first). Nothing else: working and handled sessions live in Projects.
 */
export function NeedsMeList({
  counts,
  rows,
  now,
  cursor,
  selection
}: {
  readonly counts: FleetCounts
  readonly rows: ReadonlyArray<BoardRow>
  readonly now: number
  readonly cursor: string | undefined
  readonly selection: Selection
}) {
  return (
    <div className="pb-8">
      <h2 className="sr-only">Needs me</h2>
      <div className="border-b px-4 py-3">
        <CountLine counts={counts} />
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground px-4 py-10 text-center">
          Nothing needs you. Blocked and finished sessions show up here.
        </p>
      ) : (
        <>
          <Group
            title="Blocked"
            rows={rows.filter(item => item.row.state === 'blocked')}
            now={now}
            cursor={cursor}
            selection={selection}
          />
          <Group
            title="Finished"
            rows={rows.filter(item => item.row.state === 'finished')}
            now={now}
            cursor={cursor}
            selection={selection}
          />
        </>
      )}
    </div>
  )
}
