import {
  isQuiet,
  lastActivityAt,
  pendingRetry,
  servingShells,
  waitingShells
} from '@/lib/data/vltra/state'
import type { VltraRow, SessionActivity } from '@/lib/data/vltra/types'

// Display formatting for the dashboard. Pure; times are epoch milliseconds.

const minute = 60 * 1000

const hour = 60 * minute

const day = 24 * hour

/** Compact age: `now`, `4m`, `3h`, `2d`. */
export const relativeTime = (at: number, now: number): string => {
  const age = Math.max(0, now - at)

  if (age < minute) return 'now'

  if (age < hour) return `${Math.floor(age / minute)}m`

  if (age < day) return `${Math.floor(age / hour)}h`

  return `${Math.floor(age / day)}d`
}

/** Elapsed time as a clock: `0:07`, `3:05`, `1:02:10`. */
export const elapsedText = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

export const activityText = (activity: SessionActivity): string => {
  switch (activity.kind) {
    case 'thinking':
      return 'thinking…'
    case 'writing':
      return 'writing…'
    case 'tool': {
      const tool = activity.tool ?? 'tool'

      return activity.detail === undefined ? `running ${tool}` : `${tool}: ${activity.detail}`
    }
  }
}

export const sessionTitle = (row: Pick<VltraRow, 'title' | 'id'>) => row.title ?? row.id

/** What a blocked row waits on: `1 permission · 2 questions` (whole subtree). */
export const pendingText = (row: Pick<VltraRow, 'pending'>): string =>
  [
    row.pending.permissions === 0
      ? undefined
      : plural(row.pending.permissions, 'permission', 'permissions'),
    row.pending.forms === 0 ? undefined : plural(row.pending.forms, 'question', 'questions')
  ]
    .filter(part => part !== undefined)
    .join(' · ')

/** Why a working row looks stuck: `retrying (2×, rate limited)` or `quiet 14m`; else nothing. */
export const stuckText = (row: VltraRow, now: number): string | undefined => {
  const retry = pendingRetry(row)

  if (retry !== undefined) return `retrying (${retry.attempt}×, ${retry.message})`

  const last = lastActivityAt(row)

  if (last !== undefined && isQuiet(row, now)) return `quiet ${relativeTime(last, now)}`

  return undefined
}

/**
 * What a working row only waits on, background scripts: `waiting on pnpm test · 4m` (the command
 * and how long it has run), `waiting on 2 scripts · 4m` (the oldest); else nothing.
 */
export const scriptText = (row: VltraRow, now: number): string | undefined => {
  const shells = waitingShells(row)
  const oldest = shells[0]

  if (oldest === undefined) return undefined

  const what = shells.length === 1 ? oldest.command : plural(shells.length, 'script', 'scripts')

  return `waiting on ${what} · ${relativeTime(oldest.started, now)}`
}

/**
 * The services a session left running (shells listening on a port): `serving :3000` (or
 * `serving :3000, :6006`), with their commands for a tooltip; else nothing.
 */
export const servingText = (
  row: VltraRow
): { readonly text: string; readonly commands: string } | undefined => {
  const shells = servingShells(row)

  if (shells.length === 0) return undefined

  const ports = Array.from(new Set(shells.flatMap(shell => shell.ports))).toSorted((a, b) => a - b)

  return {
    text: `serving ${ports.map(port => `:${port}`).join(', ')}`,
    commands: shells.map(shell => shell.command).join('\n')
  }
}

/** How the latest run ended (a Projects row's label). */
export const endText = (row: Pick<VltraRow, 'outcome' | 'interrupt'>): string => {
  switch (row.outcome) {
    case 'failed':
      return 'run failed'
    case 'interrupted':
      return row.interrupt === 'inactivity' ? 'stopped by OpenCode' : 'interrupted'
    case 'succeeded':
    case undefined:
      return 'finished'
  }
}

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`
