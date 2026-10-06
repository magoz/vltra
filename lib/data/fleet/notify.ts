import { Data, Duration, Match } from 'effect'
import { boardRow, fromSnapshot } from '@/lib/data/fleet/board'
import type { FleetRow, FleetSnapshot } from '@/lib/data/fleet/types'
import type { PushMessage } from '@/lib/services/push/service'

// What Fleet notifies about (DESIGN.md "Notifications"), as pure functions of two snapshots: a
// root session that starts needing me (blocked, or a run that just finished), checked again after
// a grace period against the snapshot of that moment. Everything comes from OpenCode's state as
// the store projects it (asks, `idle`, `viewed`, the handled marker); Fleet keeps no record of
// what it sent: a later notification for the same session replaces the earlier (its tag).

/** A root session that started needing me. */
export type Attention = Data.TaggedEnum<{
  /** A permission or question is waiting (its own, or a subagent's). */
  Blocked: { readonly sessionID: string }
  /** A run ended (`idle` names it) and is not handled. */
  Finished: { readonly sessionID: string; readonly idle: number }
}>

export const Attention = Data.taggedEnum<Attention>()

/**
 * How long a session must keep needing me before a push: long enough to answer or open it on the
 * screen in front of me first (a push then is noise), short enough to reach me while it matters.
 */
export const graceFor = Attention.$match({
  Blocked: () => Duration.seconds(45),
  Finished: () => Duration.minutes(2)
})

/**
 * The sessions that started needing me between two snapshots. Only rows in both: the first
 * snapshot after a start (from nothing) never notifies, and a resync after a reconnect is diffed
 * like any other change. A finished run counts once, when its `idle` changes, so reopening a
 * handled run is no news.
 */
export const attentionBetween = (
  previous: FleetSnapshot,
  next: FleetSnapshot
): ReadonlyArray<Attention> => {
  const before = fromSnapshot(previous).rows

  return Array.from(fromSnapshot(next).rows.values()).flatMap((row): ReadonlyArray<Attention> => {
    const was = before.get(row.id)

    if (was === undefined) return []

    if (row.state === 'blocked' && was.state !== 'blocked') {
      return [Attention.Blocked({ sessionID: row.id })]
    }

    if (row.state === 'finished' && row.idle !== undefined && row.idle !== was.idle) {
      return [Attention.Finished({ sessionID: row.id, idle: row.idle })]
    }

    return []
  })
}

/** Opened (in Fleet or any OpenCode UI) since the run ended. */
const seen = (row: FleetRow) =>
  row.viewed !== undefined && row.idle !== undefined && row.viewed >= row.idle

/** A session to notify about: its row and the project it is shown under. */
export type Notice = {
  readonly attention: Attention
  readonly row: FleetRow
  readonly project: string
}

/**
 * Whether the session still needs me once the grace period is over: still blocked, or the same run
 * still finished, not handled and not opened.
 */
export const stillNeeded = (attention: Attention, snapshot: FleetSnapshot): Notice | undefined => {
  const live = fromSnapshot(snapshot)
  const row = live.rows.get(attention.sessionID)

  if (row === undefined) return undefined

  const needed = Attention.$match(attention, {
    Blocked: () => row.state === 'blocked',
    Finished: ({ idle }) => row.state === 'finished' && row.idle === idle && !seen(row)
  })

  return needed ? { attention, row, project: boardRow(live, row).project } : undefined
}

/** The open session in Focus: what a tap on a notification shows. */
export const sessionUrl = (sessionID: string) => `/?${new URLSearchParams({ session: sessionID })}`

/** OpenCode's own notification titles (its web UI's), so both say the same. */
const title = (notice: Notice) =>
  Attention.$match(notice.attention, {
    Blocked: () =>
      notice.row.pending.permissions > 0 ? 'Permission required' : 'Question waiting',
    Finished: () =>
      Match.value(notice.row.outcome).pipe(
        Match.when('failed', () => 'Session error'),
        Match.when('interrupted', () => 'Session stopped'),
        Match.orElse(() => 'Response ready')
      )
  })

const sessionTitle = (row: FleetRow) => row.title ?? 'Untitled session'

/** Shown in a summary: more would be cut by the phone anyway. */
const summaryLines = 4

/**
 * One push for whatever came due together: a single session as itself (tagged with its id, so a
 * later one replaces it), several as one summary that opens Focus.
 */
export const pushMessage = (notices: ReadonlyArray<Notice>): PushMessage | undefined => {
  const [first, ...rest] = notices

  if (first === undefined) return undefined

  if (rest.length === 0) {
    return {
      title: title(first),
      body: `${first.project} · ${sessionTitle(first.row)}`,
      tag: first.row.id,
      url: sessionUrl(first.row.id)
    }
  }

  const lines = notices
    .slice(0, summaryLines)
    .map(notice => `${title(notice)}: ${notice.project} · ${sessionTitle(notice.row)}`)

  const more = notices.length - lines.length

  return {
    title: `${notices.length} sessions need you`,
    body: [...lines, ...(more > 0 ? [`and ${more} more`] : [])].join('\n'),
    tag: 'fleet-summary',
    url: '/'
  }
}

/** Notices for distinct sessions (the newest attention wins when one came due twice). */
export const distinctSessions = (notices: ReadonlyArray<Notice>): ReadonlyArray<Notice> =>
  Array.from(new Map(notices.map(notice => [notice.row.id, notice] as const)).values())
