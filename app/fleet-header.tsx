import type { StreamStatus } from '@/app/use-fleet-live'
import type { FleetConnection } from '@/lib/data/fleet/types'
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

const keyHints = [
  { keys: 'j k', label: 'move' },
  { keys: '↵', label: 'open' },
  { keys: 'h', label: 'handled' },
  { keys: 'u', label: 'undo' },
  { keys: 'a d', label: 'allow/deny' }
]

/** The sidebar's keys, desktop only (`use-fleet-keys.ts`). */
function KeyHint() {
  return (
    <p aria-label="Keyboard shortcuts" className="text-muted-foreground text-xs max-lg:hidden">
      {keyHints.map((hint, index) => (
        <span key={hint.keys} className="whitespace-nowrap">
          {index === 0 ? null : <span aria-hidden="true"> · </span>}
          <kbd className="text-foreground font-mono">{hint.keys}</kbd> {hint.label}
        </span>
      ))}
    </p>
  )
}

/** Title, the key hint, and the connection indicator. */
export function FleetHeader({
  stream,
  connection
}: {
  readonly stream: StreamStatus
  readonly connection: FleetConnection
}) {
  const link = linkStatus(stream, connection)

  return (
    <header className="flex items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3 text-sm lg:h-12">
      <h1 className="text-base font-semibold">Fleet</h1>
      <div className="flex items-baseline gap-x-5">
        <KeyHint />
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
