import {
  isQuiet,
  lastActivityAt,
  overdueWatches,
  pendingRetry,
  servicesOf,
  waitingOn,
  watchDueAt
} from '@/lib/data/vltra/state'
import type { VltraRow, SessionActivity, SessionWait } from '@/lib/data/vltra/types'

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

/**
 * Why a working row looks stuck: `retrying (2×, rate limited)`, `quiet 14m`, or `"PR 288 CI"
 * overdue 5m` (an `until` watch nothing checks, or whose wake never came); else nothing.
 */
export const stuckText = (row: VltraRow, now: number): string | undefined => {
  const retry = pendingRetry(row)

  if (retry !== undefined) return `retrying (${retry.attempt}×, ${retry.message})`

  const last = lastActivityAt(row)

  if (last !== undefined && isQuiet(row, now)) return `quiet ${relativeTime(last, now)}`

  const [overdue] = overdueWatches(row, now)

  if (overdue !== undefined) {
    return `"${overdue.label}" overdue ${relativeTime(watchDueAt(overdue), now)}`
  }

  return undefined
}

/** A one-line text and the fuller lines for its tooltip. */
export type Described = { readonly text: string; readonly details: string }

/** Local wall-clock time: `20:31`. */
const clockTime = (at: number) => {
  const date = new Date(at)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** A time ahead: `in 12m`, `in 3h`, `soon` within a minute. */
const ahead = (at: number, now: number) =>
  at - now < minute ? 'soon' : `in ${relativeTime(now, at)}`

const waitName = (wait: SessionWait) => (wait.kind === 'script' ? wait.command : `"${wait.label}"`)

const waitDetail = (wait: SessionWait, now: number) => {
  if (wait.kind === 'script')
    return `$ ${wait.command} · running ${relativeTime(wait.started, now)}`

  const next = `${wait.recurring ? 'next wake' : 'next check'} ${clockTime(wait.nextAt)}`
  const end = wait.expiresAt === undefined ? '' : ` · until ${clockTime(wait.expiresAt)}`

  return `${waitName(wait)} · ${next}${end}`
}

const waitsName = (waits: ReadonlyArray<SessionWait>) =>
  waits.every(wait => wait.kind === 'script')
    ? plural(waits.length, 'script', 'scripts')
    : waits.every(wait => wait.kind === 'watch')
      ? plural(waits.length, 'watch', 'watches')
      : `${waits.length} things`

/**
 * What a working row only waits on (`waitingOn`): `waiting on pnpm test · 4m` (a script, how long
 * it has run), `waiting on "PR 288 CI" · 12m` (an `until` watch, how long it has waited),
 * `waiting on "sync" · next wake in 12m` (a recurring watch), `waiting on 2 scripts · 4m` (the
 * oldest); the tooltip has each with its next check and deadline. Else nothing.
 */
export const waitText = (row: VltraRow, now: number): Described | undefined => {
  const waits = waitingOn(row)
  const [first] = waits

  if (first === undefined) return undefined

  const when =
    waits.length === 1 && first.kind === 'watch' && first.recurring
      ? `next wake ${ahead(first.nextAt, now)}`
      : relativeTime(first.started, now)

  return {
    text: `waiting on ${waits.length === 1 ? waitName(first) : waitsName(waits)} · ${when}`,
    details: waits.map(wait => waitDetail(wait, now)).join('\n')
  }
}

/**
 * The services a session left running (shells listening on a port): `serving :3000` (or
 * `serving :3000, :6006`), with their commands for a tooltip; else nothing.
 */
export const servingText = (row: VltraRow): Described | undefined => {
  const services = servicesOf(row)

  if (services.length === 0) return undefined

  const ports = Array.from(new Set(services.flatMap(service => service.ports))).toSorted(
    (a, b) => a - b
  )

  return {
    text: `serving ${ports.map(port => `:${port}`).join(', ')}`,
    details: services.map(service => service.command).join('\n')
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
