'use client'

import { sectionTitle } from '@/app/fleet-format'
import { HandledRow, SessionRow } from '@/app/session-row'
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
  readonly tone: 'attention' | 'muted'
}) {
  return (
    <h2
      id={id}
      className={cn(
        'flex justify-between px-4 pt-4 pb-1.5 text-xs tracking-widest uppercase',
        tone === 'attention' && 'text-attention',
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
    case 'blocked':
    case 'finished':
      return 'attention'
    case 'working':
      return 'muted'
  }
}

function HandledGroup({
  board,
  now,
  selection
}: {
  readonly board: Board
  readonly now: number
  readonly selection: Selection
}) {
  return (
    <details className="group border-hairline border-t" aria-label="Handled sessions">
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none justify-between px-4 py-3 text-xs tracking-widest uppercase md:py-2.5 [&::-webkit-details-marker]:hidden">
        <span>
          <span aria-hidden="true" className="group-open:hidden">
            +{' '}
          </span>
          <span aria-hidden="true" className="hidden group-open:inline">
            −{' '}
          </span>
          Handled
        </span>
        <span className="tabular-nums">{board.counts.handled}</span>
      </summary>
      <div className="pb-3">
        {board.handled.map(project => (
          <section key={project.id} aria-label={project.name} className="mt-1">
            <p className="px-4 pt-1 pl-8">
              <span className="font-medium">{project.name}</span>
              <span className="text-muted-foreground">
                {' '}
                · {project.worktrees.reduce((sum, worktree) => sum + worktree.rows.length, 0)}
              </span>
            </p>
            {project.worktrees.map(worktree => (
              <div key={worktree.label ?? ''}>
                {worktree.label === undefined ? null : (
                  <p className="text-muted-foreground px-4 pt-1.5 pl-10 text-xs">
                    {worktree.label} · {worktree.rows.length}
                  </p>
                )}
                <ul>
                  {worktree.rows.map(item => (
                    <HandledRow
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
      </div>
    </details>
  )
}

/** The attention list: blocked, finished, working, then handled (collapsed). */
export function FleetBoard({
  board,
  now,
  selection
}: {
  readonly board: Board
  readonly now: number
  readonly selection: Selection
}) {
  const empty = board.sections.length === 0 && board.handled.length === 0

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
          No OpenCode sessions yet. Start one in ocb; it shows up here live.
        </p>
      ) : null}
      {board.handled.length > 0 ? (
        <HandledGroup board={board} now={now} selection={selection} />
      ) : null}
    </div>
  )
}
