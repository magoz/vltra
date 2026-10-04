'use client'

import { useEffect, useState } from 'react'
import type { FleetScreen } from '@/app/fleet-href'
import { NavLink } from '@/app/nav-link'
import type { StreamStatus } from '@/app/use-fleet-live'
import { Button } from '@/components/ui/button'
import type { FleetConnection, FleetCounts } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

type LinkStatus = { readonly label: string; readonly detail: string; readonly healthy: boolean }

/** One status for two links: browser → Fleet (event stream) and Fleet → OpenCode (watcher). */
export const linkStatus = (stream: StreamStatus, connection: FleetConnection): LinkStatus => {
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

/**
 * Whether `on` has lasted `delay` ms. The wait starts over when the page shows again, so a woken
 * phone gets the same grace to reconnect as a fresh load.
 */
function useSustained(on: boolean, delay: number) {
  const [sustained, setSustained] = useState(false)

  useEffect(() => {
    if (!on) return

    let timer = setTimeout(() => setSustained(true), delay)

    const restart = () => {
      if (document.visibilityState !== 'visible') return

      clearTimeout(timer)
      setSustained(false)
      timer = setTimeout(() => setSustained(true), delay)
    }

    document.addEventListener('visibilitychange', restart)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', restart)
      setSustained(false)
    }
  }, [on, delay])

  return on && sustained
}

/** Reconnects shorter than this (a page load, a woken phone) leave the phone's screen alone. */
const reconnectGrace = 3000

/**
 * The phone's connection status (the desktop header has its own): nothing while live; once a
 * reconnect has lasted `reconnectGrace`, a slim line on top, so stale rows never pass silently.
 */
export function ConnectionLine({
  stream,
  connection
}: {
  readonly stream: StreamStatus
  readonly connection: FleetConnection
}) {
  const link = linkStatus(stream, connection)
  const shown = useSustained(!link.healthy, reconnectGrace)

  return (
    <div role="status" className="sticky top-0 z-20 lg:hidden">
      {shown ? (
        <p className="bg-background text-destructive flex items-center gap-1.5 border-b px-3 py-1.5 text-xs">
          <span
            aria-hidden="true"
            className="bg-destructive inline-block size-1.5 animate-pulse rounded-full motion-reduce:animate-none"
          />
          {link.label}
          <span className="sr-only">{link.detail}</span>
        </p>
      ) : null}
    </div>
  )
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
 * Each tab's keys (`agents-focus.tsx`, `agents-board.tsx`, `projects-grid.tsx`), plus the
 * shell's: `n` (the launcher, also `⌘K`), `b` (Focus ↔ Agents), `1` / `2` / `3` (the tabs). Most
 * needed first: on narrower desktops the last ones drop.
 */
export const keyHints: Readonly<Record<FleetScreen, ReadonlyArray<KeyHint>>> = {
  focus: [
    { keys: 'j k', label: 'move' },
    { keys: '↵', label: 'open' },
    { keys: 'h', label: 'handled' },
    { keys: 'u', label: 'undo' },
    { keys: 'b', label: 'agents' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '/', label: 'filter' },
    { keys: '1 2 3', label: 'tabs' }
  ],
  agents: [
    { keys: 'j k', label: 'move' },
    { keys: '← →', label: 'column' },
    { keys: '↵', label: 'open' },
    { keys: 'h', label: 'handled' },
    { keys: 'u', label: 'undo' },
    { keys: 'b', label: 'focus' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '/', label: 'filter' },
    { keys: '1 2 3', label: 'tabs' }
  ],
  projects: [
    { keys: '← → ↑ ↓', label: 'card' },
    { keys: 'j k', label: 'session' },
    { keys: '↵', label: 'open' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '1 2 3', label: 'tabs' }
  ]
}

/**
 * The tab's keys, wide desktops only. One line: hints that do not fit wrap onto a clipped second
 * line, so the last (least needed) ones drop whole instead of squeezing the count line.
 */
function KeyHintLine({ screen }: { readonly screen: FleetScreen }) {
  return (
    <p
      aria-label="Keyboard shortcuts"
      className="text-muted-foreground flex h-4 min-w-0 flex-wrap justify-end overflow-hidden text-xs leading-4 max-xl:hidden"
    >
      {keyHints[screen].map((hint, index) => (
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

/** The tabs, the same on desktop (header) and phone (bottom bar): Focus, Agents (the board), Projects. */
const tabs: ReadonlyArray<{ readonly screen: FleetScreen; readonly label: string }> = [
  { screen: 'focus', label: 'Focus' },
  { screen: 'agents', label: 'Agents' },
  { screen: 'projects', label: 'Projects' }
]

/** Focus | Agents | Projects: header tabs on desktop. */
function HeaderTabs({ screen }: { readonly screen: FleetScreen }) {
  return (
    <nav aria-label="Pages" className="flex self-stretch">
      {tabs.map(tab => (
        <NavLink
          key={tab.screen}
          screen={tab.screen}
          current={tab.screen === screen}
          className="text-muted-foreground hover:text-foreground aria-[current=page]:border-b-foreground aria-[current=page]:text-foreground focus-visible:ring-ring/50 flex items-center border-b-2 border-b-transparent px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Focus | Agents | Projects | +: the phone's bottom tab bar (no header there; `ConnectionLine`
 * shows only while reconnecting); + opens the launcher, full screen.
 */
export function BottomTabs({
  screen,
  onNew
}: {
  readonly screen: FleetScreen
  readonly onNew?: () => void
}) {
  return (
    <nav
      aria-label="Pages"
      className="bg-background fixed inset-x-0 bottom-0 z-20 flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {tabs.map(tab => (
        <NavLink
          key={tab.screen}
          screen={tab.screen}
          current={tab.screen === screen}
          className="text-muted-foreground aria-[current=page]:border-t-foreground aria-[current=page]:text-foreground focus-visible:ring-ring/50 -mt-px flex h-12 flex-1 items-center justify-center border-t-2 border-t-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          {tab.label}
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
 * Desktop only (the phone has the tab bar and `ConnectionLine`): title, the tabs, the count line,
 * the launcher's New, the tab's key hint, the connection.
 */
export function FleetHeader({
  screen,
  counts,
  stream,
  connection,
  onNew
}: {
  readonly screen: FleetScreen
  readonly counts: FleetCounts
  readonly stream: StreamStatus
  readonly connection: FleetConnection
  readonly onNew?: () => void
}) {
  const link = linkStatus(stream, connection)

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 flex h-12 items-center gap-x-4 border-b px-4 backdrop-blur-sm max-lg:hidden">
      <h1 className="text-base font-semibold">Fleet</h1>
      <HeaderTabs screen={screen} />
      <div className="flex-1 text-sm whitespace-nowrap">
        <CountLine counts={counts} />
      </div>
      <div className="flex min-w-0 items-center gap-x-5">
        {onNew === undefined ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={onNew}
            title="New: open a repo or start a worktree (n, ⌘K)"
          >
            New
          </Button>
        )}
        <KeyHintLine screen={screen} />
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
