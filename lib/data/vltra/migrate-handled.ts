import { Console, Effect, Option } from 'effect'
import { withConnection } from '@/lib/data/vltra/actions'

// The one-off after the Fleet → Vltra rename: the handled marker moves from `metadata.fleet` to
// `metadata.vltra`. Rewriting a marker moves it (every write drops the legacy key,
// `withVltraHandled`), so this rewrites each one as it is. Idempotent; never run automatically.
// Once it has run, the legacy read in `lib/services/opencode/mapping.ts` can go.

export type MigrateResult = {
  readonly sessions: number
  /** Sessions with a handled marker (either key) when the run started. */
  readonly marked: number
  readonly written: number
}

/**
 * Loads every session and rewrites each handled marker (or, with `dryRun`, only counts them).
 * Each write re-reads the session first and leaves it alone once it is no longer handled.
 */
export const migrateHandled = (options: { readonly dryRun: boolean }) =>
  withConnection(connection =>
    Effect.gen(function* () {
      yield* Console.log(`OpenCode ${connection.version ?? ''} at ${connection.url}`)

      const snapshot = yield* connection.snapshot
      const marked = snapshot.sessions.filter(session => session.handled !== undefined)

      yield* Console.log(
        `${snapshot.sessions.length} sessions, ${marked.length} with a handled marker: ` +
          (options.dryRun ? 'would rewrite' : 'rewriting')
      )

      if (options.dryRun) {
        const result: MigrateResult = {
          sessions: snapshot.sessions.length,
          marked: marked.length,
          written: 0
        }

        return result
      }

      const outcomes = yield* Effect.forEach(
        marked,
        session =>
          Effect.gen(function* () {
            const fresh = yield* connection.session(session.id)

            if (Option.isNone(fresh) || fresh.value.handled === undefined) return false

            yield* connection.setHandled({ sessionID: session.id, handled: fresh.value.handled })

            return true
          }),
        { concurrency: 4 }
      )

      const result: MigrateResult = {
        sessions: snapshot.sessions.length,
        marked: marked.length,
        written: outcomes.filter(Boolean).length
      }

      yield* Console.log(`Done: ${result.written} rewritten.`)

      return result
    })
  )
