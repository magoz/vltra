'use client'

import { useEffect, useState } from 'react'
import { relativeTime } from '@/app/fleet-format'
import type { FleetScreen } from '@/app/fleet-href'
import { NavLink } from '@/app/nav-link'
import type { StreamStatus } from '@/app/use-fleet-live'
import { Button } from '@/components/ui/button'
import type {
  FleetConnection,
  FleetCounts,
  UsagePool,
  UsageReading,
  UsageSummary,
  UsageWindow
} from '@/lib/data/fleet/types'
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

/** `45`, `<1`: a percentage without its sign. */
const percentText = (value: number) => (value > 0 && value < 1 ? '<1' : `${Math.round(value)}`)

/** A pool this low (% of its capacity) is about to stop the agents that use it. */
const lowUsage = 10

const isLow = (reading: UsageReading) => (reading.left / reading.capacity) * 100 <= lowUsage

/** ` of 200%` for a pool of several accounts; nothing for one, whose capacity is always 100%. */
const capacityText = (reading: UsageReading) =>
  reading.capacity > 100 ? ` of ${reading.capacity}%` : ''

const windowText = (window: UsageWindow, now: number) =>
  window.resetsAt === undefined || window.resetsAt <= now
    ? `${window.label} ${percentText(window.left)}%`
    : `${window.label} ${percentText(window.left)}% (resets in ${relativeTime(now, window.resetsAt)})`

/**
 * The usage line's hover text, a pool per line: `Claude 45% left`, then each account's windows
 * (`me@x.com: 5-hour 89% (resets in 3h) · Weekly 45% (resets in 5d)`).
 */
export const usageDetail = (pools: ReadonlyArray<UsagePool>, now: number): string =>
  pools
    .map(pool => {
      const accounts = Map.groupBy(pool.windows, window => window.account)
      const head = `${pool.name} ${pool.reading === undefined ? 'unavailable' : `${percentText(pool.reading.left)}%${capacityText(pool.reading)} left`}${pool.stale ? ' (last reading)' : ''}`

      return [
        head,
        ...Array.from(
          accounts,
          ([account, windows]) =>
            `  ${account}: ${windows.map(window => windowText(window, now)).join(' · ')}`
        )
      ].join('\n')
    })
    .join('\n')

/**
 * The subscription quotas, condensed: `Claude 106% 2d · Codex 184% 4d · Go 32% 5d`,
 * each the % left of the window that runs out first, summed over a pool's accounts (red at 10% of
 * the capacity or less), then the time to the pool's first weekly reset; every window and reset on
 * hover. Desktops under 84rem leave it out, where the count line could no longer sit centred
 * beside it.
 */
export function UsageLine({ usage, now }: { readonly usage: UsageSummary; readonly now: number }) {
  if (usage.pools.length === 0) return null

  return (
    <p
      aria-label="Usage left"
      title={usageDetail(usage.pools, now)}
      className="text-muted-foreground shrink-0 text-xs max-[84rem]:hidden"
    >
      {usage.pools.map((pool, index) => (
        <span key={pool.provider}>
          {index === 0 ? null : ' · '}
          {pool.name}{' '}
          <span
            className={cn(
              pool.reading !== undefined && isLow(pool.reading)
                ? 'text-destructive'
                : !pool.stale && 'text-foreground'
            )}
          >
            {pool.reading === undefined ? '–' : `${percentText(pool.reading.left)}%`}
          </span>
          {pool.weeklyResetAt === undefined || pool.weeklyResetAt <= now
            ? null
            : ` ${relativeTime(now, pool.weeklyResetAt)}`}
        </span>
      ))}
    </p>
  )
}

/**
 * The tabs, the same on desktop (header) and phone (bottom bar): Focus, Agents (the board),
 * Projects, Stats.
 */
const tabs: ReadonlyArray<{ readonly screen: FleetScreen; readonly label: string }> = [
  { screen: 'focus', label: 'Focus' },
  { screen: 'agents', label: 'Agents' },
  { screen: 'projects', label: 'Projects' },
  { screen: 'stats', label: 'Stats' }
]

/** Focus | Agents | Projects | Stats: header tabs on desktop. */
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
 * Focus | Agents | Projects | Stats | +: the phone's bottom tab bar (no header there;
 * `ConnectionLine` shows only while reconnecting); + opens the launcher, full screen.
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
 * Desktop only (the phone has the tab bar and `ConnectionLine`): the tabs on the left (the title
 * is screen-reader only), the count line centred, on the right the usage line, the launcher's
 * New, `?` (the keys) and the connection.
 */
export function FleetHeader({
  screen,
  counts,
  stream,
  connection,
  usage,
  now,
  onNew,
  onShortcuts
}: {
  readonly screen: FleetScreen
  readonly counts: FleetCounts
  readonly stream: StreamStatus
  readonly connection: FleetConnection
  /** The subscription quotas, once loaded. */
  readonly usage?: UsageSummary | undefined
  readonly now?: number
  readonly onNew?: () => void
  /** Opens the keys (`?`). */
  readonly onShortcuts?: () => void
}) {
  const link = linkStatus(stream, connection)

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-x-4 border-b px-4 backdrop-blur-sm max-lg:hidden">
      <div className="-ml-3 flex items-center self-stretch">
        {/* No visible title: the tabs start the bar. */}
        <h1 className="sr-only">Fleet</h1>
        <HeaderTabs screen={screen} />
      </div>
      <div className="text-sm whitespace-nowrap">
        <CountLine counts={counts} />
      </div>
      <div className="flex items-center justify-end gap-x-5 whitespace-nowrap">
        {usage === undefined || now === undefined ? null : <UsageLine usage={usage} now={now} />}
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
        {onShortcuts === undefined ? null : (
          <button
            type="button"
            onClick={onShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1.5 px-1.5 text-xs outline-none focus-visible:ring-[3px]"
          >
            ?
          </button>
        )}
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
