'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { AgentCard } from '@/app/agent-card'
import { useFleet } from '@/app/fleet-context'
import { PendingLaunches } from '@/app/pending-launches'
import { ProjectFilter } from '@/app/project-filter'
import { SessionPanel } from '@/app/session-panel'
import type { DrawerTab } from '@/app/use-drawer-tab'
import { HandledProvider, useHandled } from '@/app/use-handled'
import type { HandledFlow } from '@/app/use-handled'
import { useKeys } from '@/app/use-keys'
import { boardRow, buildNeedsMe, needsMeOrder, nextNeedsMe } from '@/lib/data/fleet/board'
import type { BoardRow } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

/** Keyboard focus in the list: the row's id, and where it was in case it leaves. */
type Cursor = { readonly id: string; readonly index: number }

/** The cursor's row: its own, or the one now in its place when it left; else the start. */
const resolve = (
  list: ReadonlyArray<BoardRow>,
  cursor: Cursor | undefined,
  selected: string | undefined
): number => {
  if (list.length === 0) return -1

  const find = (id: string | undefined) => list.findIndex(item => item.row.id === id)

  if (cursor === undefined) return Math.max(0, find(selected))

  const found = find(cursor.id)

  return found >= 0 ? found : Math.min(cursor.index, list.length - 1)
}

/** The row id a click landed on, so the cursor follows the mouse. */
const clickedRow = (event: MouseEvent) =>
  event.target instanceof Element
    ? (event.target.closest('li[data-session]')?.getAttribute('data-session') ?? undefined)
    : undefined

function Section({
  name,
  rows,
  cursor
}: {
  readonly name: string
  readonly rows: ReadonlyArray<BoardRow>
  readonly cursor: string | undefined
}) {
  if (rows.length === 0) return null

  return (
    <section aria-label={name} className="pt-3">
      <h2 className="text-attention flex items-baseline justify-between px-3 pb-1.5 text-xs tracking-widest uppercase">
        <span>{name}</span>
        <span className="tabular-nums">{rows.length}</span>
      </h2>
      <ul className="border-t">
        {rows.map(item => (
          <AgentCard key={item.row.id} item={item} cursor={item.row.id === cursor} compact />
        ))}
      </ul>
    </section>
  )
}

/** The right side with nothing open: a quiet line, desktop only. */
function EmptyPane({ empty }: { readonly empty: boolean }) {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-foreground">
        {empty ? 'Nothing needs you' : 'Pick a session on the left'}
      </p>
      <p className="text-xs">
        {empty ? (
          <>
            Working sessions are on the board (<kbd className="text-foreground">b</kbd>).
          </>
        ) : (
          <>
            <kbd className="text-foreground">j k</kbd> move ·{' '}
            <kbd className="text-foreground">↵</kbd> open
          </>
        )}
      </p>
    </div>
  )
}

function Focus({
  project,
  tab,
  onTab
}: {
  readonly project: string | undefined
  readonly tab: DrawerTab
  readonly onTab: (tab: DrawerTab) => void
}) {
  const { view, now, selection } = useFleet()
  const flow = useHandled()
  const needsMe = useMemo(() => buildNeedsMe(view, project), [view, project])
  const list = useMemo(() => needsMeOrder(needsMe), [needsMe])
  const [cursor, setCursor] = useState<Cursor>()
  const filterRef = useRef<HTMLSelectElement>(null)
  const { selected } = selection
  const index = resolve(list, cursor, selected)
  const focused = list[index]
  const selectedRow = selected === undefined ? undefined : view.rows.get(selected)
  const selectedItem = selectedRow === undefined ? undefined : boardRow(view, selectedRow)

  const focus = (item: BoardRow | undefined) => {
    if (item !== undefined) setCursor({ id: item.row.id, index: list.indexOf(item) })
  }

  /**
   * Marks `id` handled; when it is the open session (or `always`, the `h` key), the next needs-me
   * session opens, or nothing (the empty state) once none is left.
   */
  const handle = (id: string, always: boolean) => {
    const next = nextNeedsMe(list, id)
    const open = id === selected

    flow.markHandled(id)

    if (!open && !always) return

    if (next !== undefined) {
      setCursor({ id: next.row.id, index: list.indexOf(next) })
      selection.select(next.row.id)
    } else if (open) {
      selection.close()
    }
  }

  const handleRef = useRef(handle)

  useEffect(() => {
    handleRef.current = handle
  })

  // Handled from a row's or the panel's button, or a swipe: the same advance as `h`.
  const advancing: HandledFlow = useMemo(
    () => ({ ...flow, markHandled: id => handleRef.current(id, false) }),
    [flow]
  )

  const move = (delta: 1 | -1) =>
    focus(list[index < 0 ? 0 : Math.max(0, Math.min(index + delta, list.length - 1))])

  const handledKey = () => {
    const target = [focused?.row, selectedRow].find(row => row?.state === 'finished')

    if (target !== undefined) handle(target.id, true)
  }

  useKeys({
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    Enter: () => {
      if (focused !== undefined) selection.select(focused.row.id)
    },
    h: handledKey,
    u: () => {
      const id = flow.undo()

      if (id === undefined) return

      setCursor({ id, index: 0 })
      selection.select(id)
    },
    c: selected === undefined ? undefined : () => onTab(tab === 'chat' ? 'summary' : 'chat'),
    '/': () => filterRef.current?.focus()
  })

  return (
    <HandledProvider flow={advancing}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Needs you"
          className="flex flex-col lg:w-[26rem] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r"
          onClickCapture={event => {
            const id = clickedRow(event)
            const item = list.find(candidate => candidate.row.id === id)

            if (item !== undefined) focus(item)
          }}
        >
          <ProjectFilter filterRef={filterRef} className="px-3 pt-3" />
          {view.launches.length === 0 ? null : (
            <section aria-label="Provisioning" className="pt-3">
              <h2 className="text-muted-foreground flex items-baseline justify-between px-3 pb-1.5 text-xs tracking-widest uppercase">
                <span>Provisioning</span>
                <span className="tabular-nums">{view.launches.length}</span>
              </h2>
              <PendingLaunches launches={view.launches} className="border-t" />
            </section>
          )}
          <Section name="Blocked" rows={needsMe.blocked} cursor={focused?.row.id} />
          <Section name="Finished" rows={needsMe.finished} cursor={focused?.row.id} />
          {list.length === 0 ? (
            <p className="text-muted-foreground px-3 py-10 text-center lg:hidden">
              Nothing needs you.
            </p>
          ) : null}
          <div aria-hidden="true" className="h-6 shrink-0" />
        </section>
        <section
          aria-label="Session"
          data-tab={selected === undefined ? undefined : tab}
          className={cn(
            'bg-background flex min-h-0 min-w-0 flex-1 flex-col',
            selected === undefined ? 'max-lg:hidden' : 'max-lg:fixed max-lg:inset-0 max-lg:z-30'
          )}
        >
          {selected === undefined ? (
            <EmptyPane empty={list.length === 0} />
          ) : (
            <SessionPanel
              key={selected}
              sessionID={selected}
              item={selectedItem}
              now={now}
              tab={tab}
              onTab={onTab}
              onClose={selection.close}
            />
          )}
        </section>
      </div>
    </HandledProvider>
  )
}

/**
 * The Agents page's focus mode (the default, DESIGN.md "Clients" → Web): a sidebar listing the
 * launcher's launches ("Provisioning", unfiltered) and the sessions that need me (blocked,
 * longest wait first; then finished, oldest first, with Handled; rows are titles only, asks are
 * answered in the chat), narrowed by `?project=`, and the open session (`?session=`, also
 * one opened from elsewhere) inline in the rest of the page, Chat first. Handling the open
 * session opens the next one in list order. Phone: the list; a session opens full screen. Keys:
 * `j`/`k` (`↓`/`↑`) move, `Enter` opens, `h` handled (the focused or open finished session; the
 * next opens), `u` undo, `c` Summary / Chat, `/` filter (the shell adds `b` board and `Escape`
 * closes).
 */
export function AgentsFocus() {
  const { nav } = useFleet()
  // Chat first here, whatever the drawer remembers; kept while the page shows.
  const [tab, setTab] = useState<DrawerTab>('chat')

  // A new filter is a new list: the keyboard focus starts over.
  return <Focus key={nav.project ?? ''} project={nav.project} tab={tab} onTab={setTab} />
}
