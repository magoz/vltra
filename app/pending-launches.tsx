'use client'

import { Predicate } from 'effect'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { useFleet } from '@/app/fleet-context'
import { elapsedText } from '@/app/fleet-format'
import { Button } from '@/components/ui/button'
import type { Launch } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

/**
 * Time since `since` as a clock: up to `base` (the dashboard's clock, or when the launch settled),
 * plus the real time since `base` arrived while `live`, ticking every second.
 */
function useElapsed(since: number, base: number, live: boolean) {
  const [tick, setTick] = useState({ base, extra: 0 })

  useEffect(() => {
    if (!live) return

    const start = Date.now()
    const timer = setInterval(() => setTick({ base, extra: Date.now() - start }), 1000)

    return () => clearInterval(timer)
  }, [live, base])

  const extra = live && tick.base === base ? tick.extra : 0

  return elapsedText(base + extra - since)
}

const statusText: Readonly<Record<Launch['status'], string>> = {
  provisioning: 'provisioning…',
  'creating-session': 'starting the session…',
  ready: 'ready',
  failed: 'failed'
}

function DismissButton({ launch }: { readonly launch: Launch }) {
  const actions = useFleetActions()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Dismiss ${launch.branch}`}
      disabled={pending}
      className="-my-1.5 self-center"
      onClick={() =>
        startTransition(async () => {
          const result = await settled(actions.dismissLaunch({ id: launch.id }))

          if (Predicate.isTagged(result, 'Error'))
            toast.error(`Could not dismiss: ${result.message}`)
        })
      }
    >
      ×
    </Button>
  )
}

/** Setting up: a dashed square, pulsing (no session marker looks like it); failed: filled red. */
function LaunchMarker({ failed }: { readonly failed: boolean }) {
  return (
    <span
      role="img"
      aria-label={failed ? 'Launch failed' : 'Setting up'}
      className={cn(
        'inline-block size-2.5 shrink-0 translate-y-px self-center border',
        failed
          ? 'border-destructive bg-destructive'
          : 'border-foreground animate-pulse border-dashed motion-reduce:animate-none'
      )}
    />
  )
}

/**
 * A launch as a session-to-be, shaped like `AgentCard` (`compact` in focus mode's list): marker,
 * repository · branch, a ticking clock, the task as its title, then what it is doing, or the
 * failure with what was kept and ×.
 */
function LaunchCard({ launch, compact }: { readonly launch: Launch; readonly compact: boolean }) {
  const { now } = useFleet()
  const failed = launch.status === 'failed'
  // Setting up: up to the dashboard's clock, then ticking; failed: how long it ran.
  const base = failed ? launch.updatedAt : Math.max(now, launch.updatedAt)
  const elapsed = useElapsed(launch.startedAt, base, !failed)

  return (
    <li data-launch={launch.id} data-status={launch.status} className="shrink-0">
      <div
        className={cn(
          'bg-background flex flex-col',
          compact
            ? 'gap-1 border-b border-l-2 border-l-transparent py-2 pr-3 pl-2.5'
            : 'gap-1.5 border px-3 py-2.5',
          failed && 'bg-destructive/5'
        )}
      >
        <div className="text-muted-foreground flex items-baseline gap-2 text-xs">
          <LaunchMarker failed={failed} />
          <span className="min-w-0 flex-1 truncate">
            {launch.repoName} · {launch.branch}
          </span>
          <span className="shrink-0 tabular-nums">{elapsed}</span>
          {failed ? <DismissButton launch={launch} /> : null}
        </div>
        <p className="line-clamp-2 font-semibold break-words">{launch.task}</p>
        <div className="text-muted-foreground flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs break-words">
          {failed ? (
            <span className="text-destructive">{launch.error ?? 'Launch failed'}</span>
          ) : (
            <span>{statusText[launch.status]}</span>
          )}
          {failed && launch.preserved !== undefined ? <span>{launch.preserved}</span> : null}
        </div>
      </div>
    </li>
  )
}

/**
 * Launches from the launcher (DESIGN.md "Launcher and worktrees") while they have no session of
 * their own: setting up, or failed (red, what was kept, ×). Pass `pendingLaunches`: once ready,
 * a launch is just its session.
 */
export function PendingLaunches({
  launches,
  compact = false,
  className
}: {
  readonly launches: ReadonlyArray<Launch>
  readonly compact?: boolean
  readonly className?: string
}) {
  if (launches.length === 0) return null

  return (
    <ul aria-label="Launches" className={cn('flex flex-col', className)}>
      {launches.map(launch => (
        <LaunchCard key={launch.id} launch={launch} compact={compact} />
      ))}
    </ul>
  )
}
