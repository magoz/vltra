'use client'

import { sectionTitle } from '@/app/fleet-format'
import { IdleRow, SessionRow } from '@/app/session-row'
import { Button } from '@/components/ui/button'
import type { Board, BoardSection } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

type Selection = {
  readonly selected: string | undefined
  readonly onSelect: (sessionID: string) => void
}

function SectionHeading({
  id,
  title,
  count,
  tone
}: {
  readonly id: string
  readonly title: string
  readonly count: number
  readonly tone: 'attention' | 'destructive' | 'muted'
}) {
  return (
    <h2
      id={id}
      className={cn(
        'flex justify-between px-4 pt-4 pb-1.5 text-xs tracking-widest uppercase',
        tone === 'attention' && 'text-attention',
        tone === 'destructive' && 'text-destructive',
        tone === 'muted' && 'text-muted-foreground'
      )}
    >
      <span>{title}</span>
      <span className="tabular-nums">{count}</span>
    </h2>
  )
}

const sectionTone = (section: BoardSection) => {
  switch (section.state) {
    case 'needs-you':
      return 'attention'
    case 'failed':
      return 'destructive'
    case 'working':
    case 'done':
      return 'muted'
  }
}

function IdleGroup({
  board,
  now,
  showOlder,
  onShowOlder,
  selection
}: {
  readonly board: Board
  readonly now: number
  readonly showOlder: boolean
  readonly onShowOlder: (show: boolean) => void
  readonly selection: Selection
}) {
  const worktreeCount = (label: string | undefined, count: number) =>
    label === undefined ? `${count}` : `${label} ${count}`

  return (
    <details className="group border-hairline border-t" aria-label="Idle sessions">
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none justify-between px-4 py-3 text-xs tracking-widest uppercase md:py-2.5 [&::-webkit-details-marker]:hidden">
        <span>
          <span aria-hidden="true" className="group-open:hidden">
            +{' '}
          </span>
          <span aria-hidden="true" className="hidden group-open:inline">
            −{' '}
          </span>
          Idle · last {showOlder ? 'sessions' : '24h'}
        </span>
        <span className="tabular-nums">{board.counts.idle}</span>
      </summary>
      <div className="pb-3">
        {board.idle.map(project => (
          <section key={project.id} aria-label={project.name} className="mt-1">
            <p className="px-4 pt-1 pl-8">
              <span className="font-medium">{project.name}</span>
              <span className="text-muted-foreground">
                {' '}
                ·{' '}
                {project.worktrees
                  .map(worktree => worktreeCount(worktree.label, worktree.rows.length))
                  .join(' · ')}
              </span>
            </p>
            {project.worktrees.map(worktree => (
              <div key={worktree.label ?? ''}>
                {worktree.label === undefined ? null : (
                  <p className="text-muted-foreground px-4 pt-1 pl-10 text-xs">{worktree.label}</p>
                )}
                <ul>
                  {worktree.rows.map(item => (
                    <IdleRow
                      key={item.row.id}
                      item={item}
                      now={now}
                      selected={item.row.id === selection.selected}
                      onSelect={selection.onSelect}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
        {board.olderIdle > 0 || showOlder ? (
          <div className="px-4 pt-2 pl-8">
            <Button variant="ghost" size="sm" onClick={() => onShowOlder(!showOlder)}>
              {showOlder ? 'Hide older than 24h' : `Show ${board.olderIdle} older`}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  )
}

/** The state-first list: needs you, failed, working, done, then idle (collapsed). */
export function FleetBoard({
  board,
  now,
  showOlder,
  onShowOlder,
  selection
}: {
  readonly board: Board
  readonly now: number
  readonly showOlder: boolean
  readonly onShowOlder: (show: boolean) => void
  readonly selection: Selection
}) {
  const empty = board.sections.length === 0 && board.idle.length === 0

  return (
    <div className="pb-8">
      {board.sections.map(section => (
        <section key={section.state} aria-labelledby={`section-${section.state}`}>
          <SectionHeading
            id={`section-${section.state}`}
            title={sectionTitle(section.state)}
            count={section.rows.length}
            tone={sectionTone(section)}
          />
          <ul>
            {section.rows.map(item => (
              <SessionRow
                key={item.row.id}
                item={item}
                now={now}
                selected={item.row.id === selection.selected}
                onSelect={selection.onSelect}
              />
            ))}
          </ul>
        </section>
      ))}
      {empty ? (
        <p className="text-muted-foreground px-4 py-10 text-center">
          No OpenCode sessions in the last 24 hours. Start one in ocb; it shows up here live.
        </p>
      ) : null}
      {board.idle.length > 0 || board.olderIdle > 0 ? (
        <IdleGroup
          board={board}
          now={now}
          showOlder={showOlder}
          onShowOlder={onShowOlder}
          selection={selection}
        />
      ) : null}
    </div>
  )
}
