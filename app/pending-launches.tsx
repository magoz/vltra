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

const running = (launch: Launch) =>
  launch.status === 'provisioning' || launch.status === 'creating-session'

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
      className="relative z-10"
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

function LaunchItem({ launch }: { readonly launch: Launch }) {
  const { nav, now } = useFleet()
  const live = running(launch)
  const failed = launch.status === 'failed'
  const sessionID = launch.sessionID
  // Running: up to the dashboard's clock, then ticking; settled: how long it took.
  const base = live ? Math.max(now, launch.updatedAt) : launch.updatedAt
  const elapsed = useElapsed(launch.startedAt, base, live)

  return (
    <li
      data-launch={launch.id}
      data-status={launch.status}
      className={cn(
        'relative grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 px-3 py-2',
        failed && 'bg-destructive/5'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-2.5 translate-y-px self-center border',
          failed
            ? 'border-destructive bg-destructive'
            : launch.status === 'ready'
              ? 'border-attention bg-attention'
              : 'border-foreground animate-pulse motion-reduce:animate-none'
        )}
      />
      <span className="min-w-0 break-words">
        <span className="font-semibold">{launch.branch}</span>
        <span className="text-muted-foreground"> · {launch.repoName}</span>
      </span>
      <span className="text-muted-foreground flex items-center gap-1 self-start text-xs whitespace-nowrap tabular-nums">
        {elapsed}
        {live ? null : <DismissButton launch={launch} />}
      </span>
      <span className="col-start-2 flex min-w-0 flex-col gap-0.5 text-xs">
        {launch.status === 'ready' && sessionID !== undefined ? (
          <button
            type="button"
            onClick={() => nav.openSession(sessionID)}
            className="text-attention focus-visible:ring-ring/50 w-fit outline-none hover:underline focus-visible:ring-[3px]"
          >
            ready · open session
          </button>
        ) : (
          <span className={failed ? 'text-destructive break-words' : 'text-muted-foreground'}>
            {failed ? (launch.error ?? 'Launch failed') : statusText[launch.status]}
          </span>
        )}
        {failed && launch.preserved !== undefined ? (
          <span className="text-muted-foreground break-words">{launch.preserved}</span>
        ) : null}
        {failed ? null : <span className="text-muted-foreground line-clamp-2">{launch.task}</span>}
      </span>
    </li>
  )
}

/**
 * Launches from the launcher (DESIGN.md "Launcher and worktrees"): provisioning worktrees with
 * their branch, repository and elapsed time; failures in red with what was kept and a dismiss
 * button; ready ones link to their session (and can be dismissed; they go after 10 minutes).
 */
export function PendingLaunches({
  launches,
  className
}: {
  readonly launches: ReadonlyArray<Launch>
  readonly className?: string
}) {
  if (launches.length === 0) return null

  return (
    <ul aria-label="Launches" className={cn('divide-hairline divide-y', className)}>
      {launches.map(launch => (
        <LaunchItem key={launch.id} launch={launch} />
      ))}
    </ul>
  )
}
