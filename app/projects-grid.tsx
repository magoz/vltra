'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFleet } from '@/app/fleet-context'
import { relativeTime } from '@/app/fleet-format'
import { NavLink } from '@/app/nav-link'
import { ProjectRow } from '@/app/session-row'
import { useKeys } from '@/app/use-keys'
import { buildProjectCards } from '@/lib/data/fleet/board'
import type { BoardRow, ProjectCard } from '@/lib/data/fleet/board'

/** `2 need you · 1 working` (need you in green), zeros left out. */
function CardCounts({ card }: { readonly card: ProjectCard }) {
  if (card.needMe === 0 && card.working === 0) return null

  return (
    <>
      {' '}
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {card.needMe === 0 ? null : (
          <span className="text-attention">
            {card.needMe} {card.needMe === 1 ? 'needs you' : 'need you'}
          </span>
        )}
        {card.needMe === 0 || card.working === 0 ? null : ' · '}
        {card.working === 0 ? null : `${card.working} working`}
      </span>
    </>
  )
}

/** The rows `j` / `k` move through: every section, then the fold when it is open. */
const cardRows = (card: ProjectCard, expanded: boolean): ReadonlyArray<BoardRow> => [
  ...card.sections.flatMap(section => section.rows),
  ...(expanded ? card.handled : [])
]

function HandledFold({
  card,
  expanded,
  cursor,
  onToggle
}: {
  readonly card: ProjectCard
  readonly expanded: boolean
  readonly cursor: string | undefined
  readonly onToggle: () => void
}) {
  const { now } = useFleet()
  const newest = card.handled[0]

  if (newest === undefined) return null

  return (
    <div className="border-hairline mt-1 border-t pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 w-full px-3 py-1.5 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        ··· {card.handled.length} handled · last {relativeTime(newest.row.activeAt, now)}
        {expanded ? ' ×' : null}
      </button>
      {expanded ? (
        <ul aria-label={`${card.name} handled`}>
          {card.handled.map(item => (
            <ProjectRow
              key={item.row.id}
              item={item}
              now={now}
              place={card.other ? item.row.directory : item.worktree}
              cursor={item.row.id === cursor}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Card({
  card,
  cursor,
  rowCursor,
  expanded,
  onToggle
}: {
  readonly card: ProjectCard
  readonly cursor: boolean
  readonly rowCursor: string | undefined
  readonly expanded: boolean
  readonly onToggle: () => void
}) {
  const { now } = useFleet()
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (cursor) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor])

  return (
    <section
      ref={ref}
      aria-label={card.name}
      data-project={card.id}
      data-cursor={cursor}
      className="bg-background lg:data-[cursor=true]:border-attention min-w-0 border pb-1"
    >
      <NavLink
        page="agents"
        project={card.id}
        view="board"
        className="hover:bg-accent/60 focus-visible:ring-ring/50 flex items-baseline justify-between gap-3 border-b px-3 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <span className="font-semibold">{card.name}</span>
        <CardCounts card={card} />
      </NavLink>
      {card.sections.map(section => (
        <div key={section.directory} className="pt-1.5">
          {card.other ? null : (
            <h3 className="text-muted-foreground flex items-center gap-2 px-3 pb-0.5 text-xs">
              <span>{section.name}</span>
              <span aria-hidden="true" className="bg-hairline h-px flex-1" />
            </h3>
          )}
          <ul>
            {section.rows.map(item => (
              <ProjectRow
                key={item.row.id}
                item={item}
                now={now}
                place={card.other ? item.row.directory : undefined}
                cursor={item.row.id === rowCursor}
              />
            ))}
          </ul>
        </div>
      ))}
      <HandledFold card={card} expanded={expanded} cursor={rowCursor} onToggle={onToggle} />
    </section>
  )
}

/** Keyboard focus: a card, and optionally a session in it (`j` / `k`). */
type Cursor = { readonly card: string; readonly index: number; readonly row: string | undefined }

/** How many cards a grid row holds right now (1 without CSS, e.g. in tests). */
const gridColumns = (grid: HTMLElement | null) => {
  if (grid === null) return 1

  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length

  return Math.max(1, columns)
}

/**
 * The Projects page (DESIGN.md "Clients" → Web): a grid of project cards by latest activity,
 * "Other" last. The header opens the Agents board (`?view=board`) filtered to the project;
 * worktree sections list needs-me and working sessions; handled ones fold into "N handled · last
 * 2h". Keys: arrows move between cards, `j` / `k` within one, `Enter` opens the session or, on
 * the card, its board.
 */
export function ProjectsGrid() {
  const { view, selection, nav } = useFleet()
  const cards = useMemo(() => buildProjectCards(view), [view])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [cursor, setCursor] = useState<Cursor>()
  const grid = useRef<HTMLDivElement>(null)

  const found = cursor === undefined ? -1 : cards.findIndex(card => card.id === cursor.card)

  const cardIndex =
    cards.length === 0 ? -1 : found >= 0 ? found : Math.min(cursor?.index ?? 0, cards.length - 1)

  const current = cards[cardIndex]
  const rows = current === undefined ? [] : cardRows(current, expanded.has(current.id))
  const rowCursor = rows.some(item => item.row.id === cursor?.row) ? cursor?.row : undefined

  const toCard = (index: number) => {
    const card = cards[Math.max(0, Math.min(index, cards.length - 1))]

    if (card !== undefined) setCursor({ card: card.id, index: cards.indexOf(card), row: undefined })
  }

  const toRow = (delta: 1 | -1) => {
    if (current === undefined || rows.length === 0) return

    const index = rows.findIndex(item => item.row.id === rowCursor)
    const next = rows[index < 0 ? 0 : Math.max(0, Math.min(index + delta, rows.length - 1))]

    setCursor({ card: current.id, index: cardIndex, row: next?.row.id })
  }

  const toggle = (id: string) =>
    setExpanded(previous => {
      const next = new Set(previous)

      if (!next.delete(id)) next.add(id)

      return next
    })

  useKeys({
    ArrowRight: () => toCard(cardIndex + 1),
    ArrowLeft: () => toCard(cardIndex - 1),
    ArrowDown: () => toCard(cardIndex + gridColumns(grid.current)),
    ArrowUp: () => toCard(cardIndex - gridColumns(grid.current)),
    j: () => toRow(1),
    k: () => toRow(-1),
    Enter: () => {
      if (rowCursor !== undefined) selection.select(rowCursor)
      else if (current !== undefined) nav.go('agents', current.id, 'board')
    }
  })

  if (cards.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-10 text-center">
        No OpenCode sessions yet. Start one in ocb; it shows up here live.
      </p>
    )
  }

  return (
    <div className="min-h-0 flex-1 lg:overflow-y-auto">
      <h2 className="sr-only">Projects</h2>
      <div ref={grid} className="grid items-start gap-3 p-3 md:grid-cols-2 lg:p-4 xl:grid-cols-3">
        {cards.map((card, index) => (
          <Card
            key={card.id}
            card={card}
            cursor={index === cardIndex}
            rowCursor={index === cardIndex ? rowCursor : undefined}
            expanded={expanded.has(card.id)}
            onToggle={() => toggle(card.id)}
          />
        ))}
      </div>
    </div>
  )
}
