'use client'

import { useFleet } from '@/app/fleet-context'
import type { AgentsView, FleetPage } from '@/app/fleet-href'
import { NavLink } from '@/app/nav-link'
import { isPlainClick } from '@/app/session-row'
import type { StreamStatus } from '@/app/use-fleet-live'
import { Button } from '@/components/ui/button'
import type { FleetConnection, FleetCounts } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

type Link = { readonly label: string; readonly detail: string; readonly healthy: boolean }

/** One status for two links: browser → Fleet (event stream) and Fleet → OpenCode (watcher). */
export const linkStatus = (stream: StreamStatus, connection: FleetConnection): Link => {
  if (stream === 'reconnecting') {
    return { label: 'reconnecting…', detail: 'Reconnecting to Fleet', healthy: false }
  }

  if (connection.status !== 'connected') {
    return {
      label: 'reconnecting to OpenCode…',
      detail:
        connection.error === undefined
          ? 'Fleet is reconnecting to OpenCode; rows may be stale'
          : `Fleet is reconnecting to OpenCode (${connection.error}); rows may be stale`,
      healthy: false
    }
  }

  return {
    label: 'live',
    detail:
      connection.version === undefined
        ? 'Connected to OpenCode'
        : `Connected to OpenCode ${connection.version}`,
    healthy: true
  }
}

function Separator() {
  return <span className="text-muted-foreground"> · </span>
}

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

type KeyHint = { readonly keys: string; readonly label: string }

/** Which keys the header lists: the Agents page's per mode, or Projects'. */
export type KeyHintSet = AgentsView | 'projects'

export const keyHintSet = (page: FleetPage, view: AgentsView): KeyHintSet =>
  page === 'agents' ? view : 'projects'

/**
 * Each page's keys (`agents-focus.tsx`, `agents-board.tsx`, `projects-grid.tsx`), plus the
 * shell's: `n` (the launcher, also `⌘K`), `c` (Summary / Chat), `b` (the other Agents mode),
 * `1` / `2`. Most needed first: on narrower desktops the last ones drop.
 */
export const keyHints: Readonly<Record<KeyHintSet, ReadonlyArray<KeyHint>>> = {
  focus: [
    { keys: 'j k', label: 'move' },
    { keys: '↵', label: 'open' },
    { keys: 'h', label: 'handled' },
    { keys: 'u', label: 'undo' },
    { keys: 'c', label: 'chat' },
    { keys: 'b', label: 'board' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '/', label: 'filter' },
    { keys: '1 2', label: 'pages' }
  ],
  board: [
    { keys: 'j k', label: 'move' },
    { keys: '← →', label: 'column' },
    { keys: '↵', label: 'open' },
    { keys: 'h', label: 'handled' },
    { keys: 'u', label: 'undo' },
    { keys: 'a d', label: 'allow/deny' },
    { keys: 'b', label: 'focus' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '/', label: 'filter' },
    { keys: 'c', label: 'chat' },
    { keys: '1 2', label: 'pages' }
  ],
  projects: [
    { keys: '← → ↑ ↓', label: 'card' },
    { keys: 'j k', label: 'session' },
    { keys: '↵', label: 'open' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: 'c', label: 'chat' },
    { keys: '1 2', label: 'pages' }
  ]
}

/**
 * The page's keys, wide desktops only. One line: hints that do not fit wrap onto a clipped second
 * line, so the last (least needed) ones drop whole instead of squeezing the count line.
 */
function KeyHintLine({ set }: { readonly set: KeyHintSet }) {
  return (
    <p
      aria-label="Keyboard shortcuts"
      className="text-muted-foreground flex h-4 min-w-0 flex-wrap justify-end overflow-hidden text-xs leading-4 max-xl:hidden"
    >
      {keyHints[set].map((hint, index) => (
        <span key={hint.keys} className="whitespace-nowrap">
          {index === 0 ? null : (
            <span aria-hidden="true" className="whitespace-pre">
              {' · '}
            </span>
          )}
          <kbd className="text-foreground font-mono">{hint.keys}</kbd> {hint.label}
        </span>
      ))}
    </p>
  )
}

const views: ReadonlyArray<{ readonly view: AgentsView; readonly label: string }> = [
  { view: 'focus', label: 'Focus' },
  { view: 'board', label: 'Board' }
]

/**
 * The Agents page's mode, Focus | Board (`b` toggles), on desktop and phone. Links, so the mode
 * is a URL; a plain click switches in place, keeping the filter and the open session.
 */
function ViewToggle({ view }: { readonly view: AgentsView }) {
  const { nav } = useFleet()

  return (
    <div role="group" aria-label="Agents view" className="flex h-7 shrink-0 border text-xs">
      {views.map(item => (
        <a
          key={item.view}
          href={nav.href('agents', nav.project, item.view)}
          aria-current={item.view === view ? 'true' : undefined}
          onClick={event => {
            if (!isPlainClick(event)) return

            event.preventDefault()
            nav.setView(item.view)
          }}
          className="text-muted-foreground hover:text-foreground aria-[current=true]:bg-foreground aria-[current=true]:text-background focus-visible:ring-ring/50 flex items-center border-l px-2.5 outline-none first:border-l-0 focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          {item.label}
        </a>
      ))}
    </div>
  )
}

const pages: ReadonlyArray<{ readonly page: FleetPage; readonly label: string }> = [
  { page: 'agents', label: 'Agents' },
  { page: 'projects', label: 'Projects' }
]

/** Agents | Projects: header tabs on desktop. */
function HeaderTabs({ page }: { readonly page: FleetPage }) {
  return (
    <nav aria-label="Pages" className="flex self-stretch max-lg:hidden">
      {pages.map(item => (
        <NavLink
          key={item.page}
          page={item.page}
          current={item.page === page}
          className="text-muted-foreground hover:text-foreground aria-[current=page]:border-b-foreground aria-[current=page]:text-foreground focus-visible:ring-ring/50 flex items-center border-b-2 border-b-transparent px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** Agents | Projects | +: the phone's bottom tab bar (+ opens the launcher, full screen). */
export function BottomTabs({
  page,
  onNew
}: {
  readonly page: FleetPage
  readonly onNew?: () => void
}) {
  return (
    <nav
      aria-label="Pages"
      className="bg-background fixed inset-x-0 bottom-0 z-20 flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {pages.map(item => (
        <NavLink
          key={item.page}
          page={item.page}
          current={item.page === page}
          className="text-muted-foreground aria-[current=page]:border-t-foreground aria-[current=page]:text-foreground focus-visible:ring-ring/50 -mt-px flex h-12 flex-1 items-center justify-center border-t-2 border-t-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          {item.label}
        </NavLink>
      ))}
      {onNew === undefined ? null : (
        <button
          type="button"
          aria-label="New (launcher)"
          onClick={onNew}
          className="text-attention focus-visible:ring-ring/50 flex h-12 w-16 items-center justify-center border-l text-lg outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          +
        </button>
      )}
    </nav>
  )
}

/**
 * Title, the page tabs (desktop), the Agents mode toggle, the count line, the launcher's New
 * (desktop; the phone's is the tab bar's +), the page's key hint, the connection.
 */
export function FleetHeader({
  page,
  view,
  counts,
  stream,
  connection,
  onNew
}: {
  readonly page: FleetPage
  readonly view: AgentsView
  readonly counts: FleetCounts
  readonly stream: StreamStatus
  readonly connection: FleetConnection
  readonly onNew?: () => void
}) {
  const link = linkStatus(stream, connection)

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 backdrop-blur-sm lg:h-12 lg:flex-nowrap lg:py-0">
      <h1 className="text-base font-semibold">Fleet</h1>
      <HeaderTabs page={page} />
      {page === 'agents' ? <ViewToggle view={view} /> : null}
      <div className="text-xs max-lg:order-last max-lg:w-full lg:flex-1 lg:text-sm lg:whitespace-nowrap">
        <CountLine counts={counts} />
      </div>
      <div className="flex min-w-0 items-center gap-x-5 max-lg:ml-auto">
        {onNew === undefined ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={onNew}
            title="New: open a repo or start a worktree (n, ⌘K)"
            className="max-lg:hidden"
          >
            New
          </Button>
        )}
        <KeyHintLine set={keyHintSet(page, view)} />
        <p role="status" title={link.detail} className="flex shrink-0 items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className={cn(
              'inline-block size-1.5 rounded-full',
              link.healthy
                ? 'bg-attention'
                : 'bg-destructive animate-pulse motion-reduce:animate-none'
            )}
          />
          <span className={link.healthy ? 'text-muted-foreground' : 'text-destructive'}>
            {link.label}
          </span>
          <span className="sr-only">{link.detail}</span>
        </p>
      </div>
    </header>
  )
}
