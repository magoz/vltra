'use client'

import type { FleetPage } from '@/app/fleet-href'
import { NavLink } from '@/app/nav-link'
import type { StreamStatus } from '@/app/use-fleet-live'
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

/**
 * Each page's keys (`agents-board.tsx`, `projects-grid.tsx`), plus the shell's `c` (the open
 * drawer's Summary / Chat) and `1` / `2`.
 */
export const keyHints: Readonly<Record<FleetPage, ReadonlyArray<KeyHint>>> = {
  agents: [
    { keys: 'j k', label: 'move' },
    { keys: '← →', label: 'column' },
    { keys: '↵', label: 'open' },
    { keys: 'h', label: 'handled' },
    { keys: 'u', label: 'undo' },
    { keys: 'a d', label: 'allow/deny' },
    { keys: '/', label: 'filter' },
    { keys: 'c', label: 'chat' },
    { keys: '1 2', label: 'pages' }
  ],
  projects: [
    { keys: '← → ↑ ↓', label: 'card' },
    { keys: 'j k', label: 'session' },
    { keys: '↵', label: 'open' },
    { keys: 'c', label: 'chat' },
    { keys: '1 2', label: 'pages' }
  ]
}

/** The page's keys, wide desktops only. */
function KeyHintLine({ page }: { readonly page: FleetPage }) {
  return (
    <p aria-label="Keyboard shortcuts" className="text-muted-foreground text-xs max-xl:hidden">
      {keyHints[page].map((hint, index) => (
        <span key={hint.keys} className="whitespace-nowrap">
          {index === 0 ? null : <span aria-hidden="true"> · </span>}
          <kbd className="text-foreground font-mono">{hint.keys}</kbd> {hint.label}
        </span>
      ))}
    </p>
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

/** Agents | Projects: the phone's bottom tab bar. */
export function BottomTabs({ page }: { readonly page: FleetPage }) {
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
    </nav>
  )
}

/** Title, the page tabs (desktop), the count line, the page's key hint, the connection. */
export function FleetHeader({
  page,
  counts,
  stream,
  connection
}: {
  readonly page: FleetPage
  readonly counts: FleetCounts
  readonly stream: StreamStatus
  readonly connection: FleetConnection
}) {
  const link = linkStatus(stream, connection)

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 backdrop-blur-sm lg:h-12 lg:flex-nowrap lg:py-0">
      <h1 className="text-base font-semibold">Fleet</h1>
      <HeaderTabs page={page} />
      <div className="text-xs max-lg:order-last max-lg:w-full lg:flex-1 lg:text-sm">
        <CountLine counts={counts} />
      </div>
      <div className="flex items-center gap-x-5 max-lg:ml-auto">
        <KeyHintLine page={page} />
        <p role="status" title={link.detail} className="flex items-center gap-1.5 text-xs">
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
