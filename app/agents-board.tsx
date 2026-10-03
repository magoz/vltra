'use client'

import { Predicate } from 'effect'
import { useMemo, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import { toast } from 'sonner'
import { AgentCard } from '@/app/agent-card'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { useFleet } from '@/app/fleet-context'
import { permissionTarget } from '@/app/fleet-format'
import { NavLink } from '@/app/nav-link'
import { firstPermission } from '@/app/pending-asks'
import { useHandled } from '@/app/use-handled'
import { useKeys } from '@/app/use-keys'
import {
  boardColumns,
  buildAgentsBoard,
  buildProjectCards,
  initialColumn,
  projectName
} from '@/lib/data/fleet/board'
import type { AgentsBoard as Board, BoardColumn, BoardRow } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

const columnNames: Readonly<Record<BoardColumn, string>> = {
  blocked: 'Blocked',
  finished: 'Finished',
  working: 'Working',
  handled: 'Handled'
}

const emptyText: Readonly<Record<BoardColumn, string>> = {
  blocked: 'Nothing waits on you.',
  finished: 'No finished runs to look at.',
  working: 'Nothing running.',
  handled: 'Nothing handled in the last 24h.'
}

const needsMe = (column: BoardColumn) => column === 'blocked' || column === 'finished'

/** Keyboard focus: the card's id, its column, and where it was in case it leaves. */
type Cursor = { readonly column: BoardColumn; readonly id: string; readonly index: number }

type Position = {
  readonly column: BoardColumn
  readonly index: number
  readonly item: BoardRow
}

const at = (board: Board, column: BoardColumn, index: number): Position | undefined => {
  const item = board.columns[column][index]

  return item === undefined ? undefined : { column, index, item }
}

/** Where focus starts: the first needs-me card. */
const firstNeedsMe = (board: Board) => at(board, 'blocked', 0) ?? at(board, 'finished', 0)

/** The first card of the first column with any (for `j` / arrows with no focus yet). */
const firstCard = (board: Board) =>
  boardColumns.map(column => at(board, column, 0)).find(Predicate.isNotUndefined)

/** The cursor's card: its own, or the one now in its place when it left; else the start. */
const resolve = (board: Board, cursor: Cursor | undefined): Position | undefined => {
  if (cursor === undefined) return firstNeedsMe(board)

  const rows = board.columns[cursor.column]

  if (rows.length === 0) return firstNeedsMe(board)

  const found = rows.findIndex(item => item.row.id === cursor.id)

  return at(board, cursor.column, found >= 0 ? found : Math.min(cursor.index, rows.length - 1))
}

/** The next column in `direction` with cards, keeping the row as far as it goes. */
const sideways = (board: Board, from: Position, direction: 1 | -1): Position | undefined => {
  const start = boardColumns.indexOf(from.column)

  for (
    let index = start + direction;
    index >= 0 && index < boardColumns.length;
    index += direction
  ) {
    const column = boardColumns[index]

    if (column === undefined) continue

    const rows = board.columns[column]

    if (rows.length > 0) return at(board, column, Math.min(from.index, rows.length - 1))
  }

  return undefined
}

/** The card id a click landed on, so the cursor follows the mouse. */
const clickedCard = (event: MouseEvent) =>
  event.target instanceof Element
    ? (event.target.closest('li[data-session]')?.getAttribute('data-session') ?? undefined)
    : undefined

function Column({
  column,
  rows,
  cursor,
  olderHandled,
  shown,
  onCardClick
}: {
  readonly column: BoardColumn
  readonly rows: ReadonlyArray<BoardRow>
  readonly cursor: string | undefined
  readonly olderHandled: number
  /** The phone shows one column at a time. */
  readonly shown: boolean
  readonly onCardClick: (column: BoardColumn, id: string) => void
}) {
  const attention = needsMe(column) && rows.length > 0

  return (
    <section
      aria-label={columnNames[column]}
      data-column={column}
      className={cn(
        'bg-muted/40 flex min-h-0 min-w-0 flex-col lg:border',
        shown ? undefined : 'max-lg:hidden'
      )}
    >
      <h2
        className={cn(
          'flex items-baseline justify-between px-3 pt-2.5 pb-2 text-xs tracking-widest uppercase max-lg:sr-only',
          attention ? 'text-attention' : 'text-muted-foreground'
        )}
      >
        <span>{columnNames[column]}</span>
        <span className="tabular-nums">{column === 'handled' ? '24h' : rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-xs">{emptyText[column]}</p>
      ) : (
        <ul
          className="flex flex-col gap-2 px-2 pb-2 max-lg:pt-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          onClickCapture={event => {
            const id = clickedCard(event)

            if (id !== undefined) onCardClick(column, id)
          }}
        >
          {rows.map(item => (
            <AgentCard key={item.row.id} item={item} cursor={item.row.id === cursor} />
          ))}
        </ul>
      )}
      {column === 'handled' && olderHandled > 0 ? (
        <NavLink
          page="projects"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 px-3 pt-1 pb-3 text-xs outline-none focus-visible:ring-[3px]"
        >
          {olderHandled} more → Projects
        </NavLink>
      ) : null}
    </section>
  )
}

/** The phone's column picker: `Blocked 2 · Finished 4 · Working 5 · Handled`. */
function Segments({
  board,
  current,
  onSelect
}: {
  readonly board: Board
  readonly current: BoardColumn
  readonly onSelect: (column: BoardColumn) => void
}) {
  return (
    <div role="tablist" aria-label="Columns" className="mx-3 mt-2 flex border lg:hidden">
      {boardColumns.map(column => {
        const count = board.columns[column].length

        return (
          <button
            key={column}
            type="button"
            role="tab"
            aria-selected={column === current}
            onClick={() => onSelect(column)}
            className={cn(
              'focus-visible:ring-ring/50 aria-selected:bg-foreground aria-selected:text-background flex h-9 flex-1 items-center justify-center border-l text-xs outline-none first:border-l-0 focus-visible:ring-[3px] focus-visible:ring-inset',
              needsMe(column) && count > 0
                ? 'text-attention font-semibold'
                : 'text-muted-foreground'
            )}
          >
            {columnNames[column]}
            {column === 'handled' ? null : (
              <>
                {' '}
                <span className="tabular-nums">{count}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The project filter: a select (`/` focuses it) and, while filtered, a chip with ×. */
function ProjectFilter({ filterRef }: { readonly filterRef: RefObject<HTMLSelectElement | null> }) {
  const { view, nav } = useFleet()

  const projects = useMemo(
    () => buildProjectCards(view).map(card => ({ id: card.id, name: card.name })),
    [view]
  )

  const options =
    nav.project === undefined || projects.some(project => project.id === nav.project)
      ? projects
      : [...projects, { id: nav.project, name: projectName(view, nav.project) }]

  const current = options.find(project => project.id === nav.project)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-3 lg:px-4 lg:pt-3">
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <span>Project</span>
        <select
          ref={filterRef}
          value={nav.project ?? ''}
          onChange={event =>
            nav.setProject(event.target.value === '' ? undefined : event.target.value)
          }
          onKeyDown={event => {
            if (event.key !== 'Escape') return

            event.preventDefault()
            event.currentTarget.blur()
          }}
          className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-7 border px-1.5 font-mono text-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="">All projects</option>
          {options.map(project => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {current === undefined ? null : (
        <span className="border-foreground flex items-center gap-1 border py-0.5 pr-0.5 pl-2 text-xs">
          {current.name}
          <button
            type="button"
            aria-label={`Clear the ${current.name} filter`}
            onClick={() => nav.setProject(undefined)}
            className="hover:bg-accent focus-visible:ring-ring/50 flex size-5 items-center justify-center outline-none focus-visible:ring-[3px]"
          >
            ×
          </button>
        </span>
      )}
    </div>
  )
}

function Board({ project }: { readonly project: string | undefined }) {
  const { view, now, selection } = useFleet()
  const actions = useFleetActions()
  const flow = useHandled()
  const board = useMemo(() => buildAgentsBoard(view, now, project), [view, now, project])
  const [segment, setSegment] = useState<BoardColumn>(() => initialColumn(board))
  const [cursor, setCursor] = useState<Cursor>()
  const filterRef = useRef<HTMLSelectElement>(null)
  // Permissions answered from the keyboard, so a repeated key does not send twice.
  const answered = useRef(new Set<string>())
  const position = resolve(board, cursor)

  const focus = (target: Position | undefined) => {
    if (target !== undefined) {
      setCursor({ column: target.column, id: target.item.row.id, index: target.index })
    }
  }

  const vertical = (delta: 1 | -1) => {
    if (position === undefined) {
      focus(firstCard(board))

      return
    }

    const rows = board.columns[position.column]

    focus(
      at(board, position.column, Math.max(0, Math.min(position.index + delta, rows.length - 1)))
    )
  }

  const horizontal = (direction: 1 | -1) =>
    focus(position === undefined ? firstCard(board) : sideways(board, position, direction))

  const reply = (decision: 'once' | 'reject') => {
    const permission = position === undefined ? undefined : firstPermission(position.item.row)

    if (permission === undefined || answered.current.has(permission.id)) return

    answered.current.add(permission.id)

    settled(
      actions.replyPermission({
        sessionID: permission.sessionID,
        requestID: permission.id,
        decision
      })
    ).then(result => {
      if (Predicate.isTagged(result, 'Error')) {
        answered.current.delete(permission.id)
        toast.error(`Could not reply to the permission: ${result.message}`)

        return
      }

      toast(decision === 'once' ? 'Allowed once' : 'Denied', {
        description: `${permission.action} ${permissionTarget(permission)}`
      })
    })
  }

  const handled = () => {
    if (position === undefined || position.item.row.state !== 'finished') return

    const rows = board.columns.finished
    const next = rows[position.index + 1] ?? rows[position.index - 1]

    flow.markHandled(position.item.row.id)
    setCursor({ column: 'finished', id: next?.row.id ?? '', index: position.index })
  }

  useKeys({
    j: () => vertical(1),
    ArrowDown: () => vertical(1),
    k: () => vertical(-1),
    ArrowUp: () => vertical(-1),
    ArrowRight: () => horizontal(1),
    ArrowLeft: () => horizontal(-1),
    Enter: () => {
      if (position !== undefined) selection.select(position.item.row.id)
    },
    h: handled,
    u: () => {
      const id = flow.undo()

      if (id !== undefined) setCursor({ column: 'finished', id, index: 0 })
    },
    a: () => reply('once'),
    d: () => reply('reject'),
    '/': () => filterRef.current?.focus()
  })

  const cursorID = position?.item.row.id

  return (
    <>
      <ProjectFilter filterRef={filterRef} />
      <Segments board={board} current={segment} onSelect={setSegment} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 py-2 lg:grid lg:grid-cols-4 lg:p-4 lg:pt-3">
        {boardColumns.map(column => (
          <Column
            key={column}
            column={column}
            rows={board.columns[column]}
            cursor={cursorID}
            olderHandled={board.olderHandled}
            shown={column === segment}
            onCardClick={(clicked, id) =>
              setCursor({
                column: clicked,
                id,
                index: board.columns[clicked].findIndex(item => item.row.id === id)
              })
            }
          />
        ))}
      </div>
    </>
  )
}

/**
 * The Agents page (DESIGN.md "Clients" → Web): a kanban board by state across all projects, or
 * one project (`?project=`). Columns `Blocked | Finished | Working | Handled` on desktop, one at a
 * time on the phone. Keys: `j`/`k` (`↓`/`↑`) within a column, `←`/`→` between columns, `h`
 * handled (and next finished card), `u` undo, `a`/`d` allow once / deny, `Enter` opens the
 * drawer, `/` focuses the project filter.
 */
export function AgentsBoard() {
  const { nav } = useFleet()

  // A new filter is a new board: the phone column and the focus start over.
  return <Board key={nav.project ?? ''} project={nav.project} />
}
