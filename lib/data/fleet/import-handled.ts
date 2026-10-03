import { Console, Effect, Option } from 'effect'
import { withConnection } from '@/lib/data/fleet/actions'
import type { SessionRecord } from '@/lib/data/fleet/types'

// The one-off rollout of the attention model (DESIGN.md "Session state", Rollout): every root
// session whose latest run was already viewed in OpenCode (`viewed >= idle`) and has no handled
// marker gets `metadata.fleet.handled = idle`. Idempotent; never run automatically.

export type ImportTarget = {
  readonly sessionID: string
  readonly idle: number
  readonly title: string | undefined
}

export type ImportPlan = {
  readonly sessions: number
  readonly roots: number
  /** Roots that already carry a handled marker (any run). */
  readonly marked: number
  /** Roots that never ran: nothing to handle. */
  readonly neverRan: number
  /** Roots whose latest run is unread in OpenCode: they stay finished. */
  readonly unread: number
  readonly targets: ReadonlyArray<ImportTarget>
}

const isViewed = (session: SessionRecord, idle: number) =>
  session.viewed !== undefined && session.viewed >= idle

/** Which root sessions to mark handled, and why the others are left alone. */
export const planImportHandled = (sessions: ReadonlyArray<SessionRecord>): ImportPlan => {
  const ids = new Set(sessions.map(session => session.id))

  const roots = sessions.filter(
    session => session.parentID === undefined || !ids.has(session.parentID)
  )

  const unmarked = roots.filter(session => session.handled === undefined)

  const targets = unmarked.flatMap((session): ReadonlyArray<ImportTarget> => {
    const idle = session.idle

    return idle !== undefined && isViewed(session, idle)
      ? [{ sessionID: session.id, idle, title: session.title }]
      : []
  })

  const neverRan = unmarked.filter(session => session.idle === undefined).length

  return {
    sessions: sessions.length,
    roots: roots.length,
    marked: roots.length - unmarked.length,
    neverRan,
    unread: unmarked.length - neverRan - targets.length,
    targets
  }
}

export type ImportResult = {
  readonly plan: ImportPlan
  readonly written: number
  /** Targets that changed since the plan (a marker appeared): left alone. */
  readonly skipped: number
}

const targetLine = (target: ImportTarget) =>
  `${target.sessionID}  ${new Date(target.idle).toISOString()}  ${target.title ?? ''}`

/**
 * Loads every session and writes the handled markers (or, with `dryRun`, only lists them). Each
 * write re-reads the session first and leaves it alone if a marker appeared meanwhile.
 */
export const importHandled = (options: { readonly dryRun: boolean }) =>
  withConnection(connection =>
    Effect.gen(function* () {
      yield* Console.log(`OpenCode ${connection.version ?? ''} at ${connection.url}`)

      const snapshot = yield* connection.snapshot
      const plan = planImportHandled(snapshot.sessions)

      yield* Console.log(
        [
          `${plan.sessions} sessions, ${plan.roots} root sessions:`,
          `  ${plan.marked} already have a handled marker`,
          `  ${plan.neverRan} never ran`,
          `  ${plan.unread} finished but unread in OpenCode (stay finished)`,
          `  ${plan.targets.length} viewed → ${options.dryRun ? 'would mark' : 'marking'} handled`
        ].join('\n')
      )

      if (options.dryRun) {
        yield* Effect.forEach(plan.targets, target => Console.log(`  ${targetLine(target)}`), {
          discard: true
        })

        const result: ImportResult = { plan, written: 0, skipped: 0 }

        return result
      }

      const outcomes = yield* Effect.forEach(
        plan.targets,
        target =>
          Effect.gen(function* () {
            const fresh = yield* connection.session(target.sessionID)

            if (Option.isNone(fresh) || fresh.value.handled !== undefined) return false

            yield* connection.setHandled({ sessionID: target.sessionID, handled: target.idle })
            yield* Console.log(`  handled ${targetLine(target)}`)

            return true
          }),
        { concurrency: 4 }
      )

      const written = outcomes.filter(Boolean).length
      const result: ImportResult = { plan, written, skipped: outcomes.length - written }

      yield* Console.log(`Done: ${result.written} marked handled, ${result.skipped} skipped.`)

      return result
    })
  )
