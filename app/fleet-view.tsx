'use client'

import { Predicate } from 'effect'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { permissionTarget } from '@/app/fleet-format'
import { FleetHeader } from '@/app/fleet-header'
import { NeedsMeList } from '@/app/needs-me-list'
import { firstPermission } from '@/app/pending-asks'
import { ProjectsList } from '@/app/projects-list'
import { SessionPanel } from '@/app/session-panel'
import type { StreamStatus } from '@/app/use-fleet-live'
import { useFleetKeys } from '@/app/use-fleet-keys'
import { HandledProvider, useHandledFlow } from '@/app/use-handled'
import { boardRow, buildBoard, withOverrides } from '@/lib/data/fleet/board'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

/** The open session (`?session=`, see `use-selected-session.ts`). */
export type SessionSelection = {
  readonly selected: string | undefined
  readonly select: (sessionID: string) => void
  readonly close: () => void
}

type Tab = 'needs-me' | 'projects'

/** Keyboard focus in the sidebar: the row's id, and where it was in case it leaves the list. */
type Cursor = { readonly id: string; readonly index: number }

/** The cursor's row index: its row, or the row now in its place when it left; -1 for none. */
const cursorPosition = (ids: ReadonlyArray<string>, cursor: Cursor | undefined) => {
  if (cursor === undefined || ids.length === 0) return -1

  const found = ids.indexOf(cursor.id)

  return found >= 0 ? found : Math.min(cursor.index, ids.length - 1)
}

function TabButton({
  tab,
  current,
  onSelect,
  children
}: {
  readonly tab: Tab
  readonly current: Tab
  readonly onSelect: (tab: Tab) => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${tab}`}
      aria-controls={tab}
      aria-selected={tab === current}
      onClick={() => onSelect(tab)}
      className="text-muted-foreground aria-selected:border-b-foreground aria-selected:text-foreground focus-visible:ring-ring/50 flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 border-b-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
    >
      {children}
    </button>
  )
}

/**
 * The dashboard (DESIGN.md "Clients" → Web): the needs-me sidebar and Projects side by side from
 * `lg` (two tabs below it), the session panel, Handled with Undo, and the sidebar's keys.
 */
export function FleetView({
  live,
  stream,
  now,
  selection
}: {
  readonly live: LiveFleet
  readonly stream: StreamStatus
  readonly now: number
  readonly selection: SessionSelection
}) {
  const actions = useFleetActions()
  const flow = useHandledFlow(actions, live.rows)
  const view = useMemo(() => withOverrides(live, flow.overrides), [live, flow.overrides])
  const board = useMemo(() => buildBoard(view, now), [view, now])
  const [tab, setTab] = useState<Tab>('needs-me')
  const [cursor, setCursor] = useState<Cursor>()
  // Permissions answered from the keyboard, so a repeated key does not send twice.
  const answered = useRef(new Set<string>())
  const { selected } = selection
  const ids = board.needsMe.map(item => item.row.id)
  const cursorIndex = cursorPosition(ids, cursor)
  const cursorItem = board.needsMe[cursorIndex]
  const selectedRow = selected === undefined ? undefined : view.rows.get(selected)
  const selectedItem = selectedRow === undefined ? undefined : boardRow(view, selectedRow)

  const moveTo = (index: number) => {
    const id = ids[index]

    if (id !== undefined) setCursor({ id, index })
  }

  const reply = (decision: 'once' | 'reject') => {
    const permission = cursorItem === undefined ? undefined : firstPermission(cursorItem.row)

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

  useFleetKeys({
    next: () => moveTo(cursorIndex < 0 ? 0 : Math.min(cursorIndex + 1, ids.length - 1)),
    previous: () => moveTo(Math.max(cursorIndex - 1, 0)),
    open: () => {
      if (cursorItem !== undefined) selection.select(cursorItem.row.id)
    },
    handled: () => {
      if (cursorItem === undefined || cursorItem.row.state !== 'finished') return

      const next = ids[cursorIndex + 1] ?? ids[cursorIndex - 1]

      flow.markHandled(cursorItem.row.id)
      setCursor(next === undefined ? undefined : { id: next, index: cursorIndex })
    },
    undo: () => {
      const id = flow.undo()

      if (id !== undefined) setCursor({ id, index: Math.max(cursorIndex, 0) })
    },
    approve: () => reply('once'),
    deny: () => reply('reject'),
    close: () => {
      if (selected !== undefined) selection.close()
    }
  })

  const sidebarSelection = {
    selected,
    onSelect: (sessionID: string) => {
      setCursor({ id: sessionID, index: ids.indexOf(sessionID) })
      selection.select(sessionID)
    }
  }

  const needMe = board.counts.blocked + board.counts.finished

  return (
    <HandledProvider flow={flow}>
      <div className="flex min-h-dvh flex-col font-mono text-sm lg:h-dvh">
        <div className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 backdrop-blur-sm">
          <FleetHeader stream={stream} connection={live.connection} />
          <div role="tablist" aria-label="Views" className="flex border-b lg:hidden">
            <TabButton tab="needs-me" current={tab} onSelect={setTab}>
              Needs me{' '}
              <span className={cn('tabular-nums', needMe > 0 && 'text-attention font-semibold')}>
                {needMe}
              </span>
            </TabButton>
            <TabButton tab="projects" current={tab} onSelect={setTab}>
              Projects
            </TabButton>
          </div>
        </div>
        <div
          className={cn(
            'flex-1 lg:grid lg:min-h-0',
            selected === undefined
              ? 'lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)]'
              : 'lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)_minmax(0,1.1fr)]'
          )}
        >
          <section
            id="needs-me"
            aria-label="Needs me"
            className={cn(
              'min-w-0 lg:overflow-y-auto lg:border-r',
              tab === 'needs-me' ? null : 'max-lg:hidden'
            )}
          >
            <NeedsMeList
              counts={board.counts}
              rows={board.needsMe}
              now={now}
              cursor={cursorItem?.row.id}
              selection={sidebarSelection}
            />
          </section>
          <section
            id="projects"
            aria-label="Projects"
            className={cn(
              'min-w-0 lg:overflow-y-auto',
              tab === 'projects' ? null : 'max-lg:hidden',
              selected === undefined ? null : 'lg:max-xl:hidden'
            )}
          >
            <ProjectsList
              projects={board.projects}
              now={now}
              selection={{ selected, onSelect: selection.select }}
            />
          </section>
          {selected === undefined ? null : (
            <aside
              aria-label="Session"
              className="bg-background max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:overflow-y-auto max-lg:overscroll-contain lg:overflow-y-auto lg:border-l"
            >
              <SessionPanel
                key={selected}
                sessionID={selected}
                item={selectedItem}
                now={now}
                onClose={selection.close}
              />
            </aside>
          )}
        </div>
      </div>
    </HandledProvider>
  )
}
