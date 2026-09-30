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

function Counts({ counts }: { readonly counts: FleetCounts }) {
  const active = counts['needs-you'] + counts.failed + counts.working + counts.done

  return (
    <p className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1" aria-label="Session counts">
      {counts['needs-you'] > 0 ? (
        <span className="text-attention font-semibold whitespace-nowrap">
          {counts['needs-you']} need you
        </span>
      ) : null}
      {counts.working > 0 ? (
        <span className="whitespace-nowrap">{counts.working} working</span>
      ) : null}
      {counts.failed > 0 ? (
        <span className="text-destructive whitespace-nowrap">{counts.failed} failed</span>
      ) : null}
      {counts.done > 0 ? <span className="whitespace-nowrap">{counts.done} done</span> : null}
      {active === 0 ? <span className="text-muted-foreground">nothing needs you</span> : null}
      {counts.idle > 0 ? (
        <span className="text-muted-foreground whitespace-nowrap max-md:hidden">
          {counts.idle} idle
        </span>
      ) : null}
    </p>
  )
}

/** Title, live counts, and the connection indicator. */
export function FleetHeader({
  counts,
  stream,
  connection
}: {
  readonly counts: FleetCounts
  readonly stream: StreamStatus
  readonly connection: FleetConnection
}) {
  const link = linkStatus(stream, connection)

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3 text-sm backdrop-blur-sm lg:h-12">
      <h1 className="text-base font-semibold">Fleet</h1>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Counts counts={counts} />
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
