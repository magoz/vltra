'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DeleteProject } from '@/app/delete-project'
import { useVltra } from '@/app/vltra-context'
import { relativeTime } from '@/app/vltra-format'
import { entryForProject, useLauncher } from '@/app/launcher-context'
import { NavLink } from '@/app/nav-link'
import { RetireWorktree } from '@/app/retire-worktree'
import { SessionSplit } from '@/app/session-panel'
import { ProjectRow } from '@/app/session-row'
import { useKeys } from '@/app/use-keys'
import { OwnerBadge, PrBadge } from '@/app/worktree-badges'
import { buildProjectCards, cardSections } from '@/lib/data/vltra/board'
import type { BoardRow, ProjectCard, WorktreeSection } from '@/lib/data/vltra/board'
import type { LauncherRepo } from '@/lib/data/vltra/types'

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
  const { now } = useVltra()
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
        ··· {card.handled.length} done · last {relativeTime(newest.row.activeAt, now)}
        {expanded ? ' ×' : null}
      </button>
      {expanded ? (
        <ul aria-label={`${card.name} done`}>
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

/**
 * A worktree section's heading line: its branch (else its folder), owner (`pi` for Pi/Herdr),
 * PR state, and Retire for Vltra/OpenCode worktrees.
 */
function SectionHeading({
  section,
  projectID
}: {
  readonly section: WorktreeSection
  readonly projectID: string
}) {
  const { worktree } = section

  return (
    <div className="text-muted-foreground flex min-h-6 items-center gap-2 px-3 pb-0.5 text-xs">
      <h3 title={section.directory} className="min-w-0 truncate">
        {worktree?.branch ?? section.name}
      </h3>
      {worktree === undefined ? null : (
        <>
          <OwnerBadge owner={worktree.owner} branch={worktree.branch} />
          <PrBadge pr={worktree.pr} link />
        </>
      )}
      <span aria-hidden="true" className="bg-hairline h-px min-w-4 flex-1" />
      {worktree?.owner === 'dotfiles' ? (
        <RetireWorktree projectID={projectID} worktree={worktree} />
      ) : null}
    </div>
  )
}

function Card({
  card,
  entry,
  cursor,
  rowCursor,
  expanded,
  onToggle
}: {
  readonly card: ProjectCard
  /** The card's repository in the launcher, when it is one on the host. */
  readonly entry: LauncherRepo | undefined
  readonly cursor: boolean
  readonly rowCursor: string | undefined
  readonly expanded: boolean
  readonly onToggle: () => void
}) {
  const { now } = useVltra()
  const launcher = useLauncher()
  const ref = useRef<HTMLElement>(null)
  const sections = useMemo(() => cardSections(card, entry), [card, entry])

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
      <div className="flex border-b">
        <NavLink
          screen="agents"
          project={card.id}
          className="hover:bg-accent/60 focus-visible:ring-ring/50 flex min-w-0 flex-1 items-baseline justify-between gap-3 px-3 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          <span className="font-semibold">{card.name}</span>
          <CardCounts card={card} />
        </NavLink>
        {entry === undefined ? null : (
          <button
            type="button"
            aria-label={`New worktree in ${entry.name}`}
            title={`New worktree in ${entry.name}`}
            onClick={() => launcher.open({ step: 'new', repo: entry.directory })}
            className="text-attention hover:bg-accent/60 focus-visible:ring-ring/50 border-l px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            +
          </button>
        )}
        <DeleteProject card={card} />
      </div>
      {sections.map(section => (
        <div key={section.directory} data-worktree={section.directory} className="pt-1.5">
          {card.other ? null : (
            <SectionHeading section={section} projectID={entry?.projectID ?? card.id} />
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
 * "Other" last. The header opens the Agents board (`?view=agents`) filtered to the project, its +
 * the launcher's new-worktree step for the repository; worktree sections list needs-me and working
 * sessions under the branch, owner (`pi`), PR state and Retire (Vltra/OpenCode worktrees), and the
 * repository's other branch worktrees follow without sessions; handled ones fold into "N handled ·
 * last 2h". An open session (`?session=`) docks its chat on the right (`SessionSplit`) and the grid
 * loses a column when it gets too narrow. Keys: arrows move between cards, `j` / `k` within one,
 * `Enter` opens the session or, on the card, its board.
 */
export function ProjectsGrid() {
  const { view, selection, nav } = useVltra()
  const launcher = useLauncher()
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
      else if (current !== undefined) nav.show('agents', current.id)
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
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Columns by the grid's own width, so an open chat beside it takes one away. */}
      <div className="@container min-h-0 min-w-0 flex-1 lg:overflow-y-auto">
        <h2 className="sr-only">Projects</h2>
        <div
          ref={grid}
          className="grid items-start gap-3 p-3 lg:p-4 @3xl:grid-cols-2 @7xl:grid-cols-3"
        >
          {cards.map((card, index) => (
            <Card
              key={card.id}
              card={card}
              entry={
                card.other
                  ? undefined
                  : entryForProject(launcher.list, card.id, view.projects.get(card.id)?.directory)
              }
              cursor={index === cardIndex}
              rowCursor={index === cardIndex ? rowCursor : undefined}
              expanded={expanded.has(card.id)}
              onToggle={() => toggle(card.id)}
            />
          ))}
        </div>
      </div>
      <SessionSplit />
    </div>
  )
}
