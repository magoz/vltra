import { Cache, Context, Data, Effect, Exit, Layer, Option, Schema } from 'effect'
import { withConnection } from '@/lib/data/fleet/actions'
import type {
  ChangeTotals,
  FileChange,
  SessionDetail,
  SessionSummary
} from '@/lib/data/fleet/types'
import type { OpenCodeRequestError, OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import { OpenCode } from '@/lib/services/opencode/service'
import type { ActionError } from '@/lib/services/opencode/service'

// Read-only session data for the dashboard, fetched from OpenCode on demand (never through the
// watcher): the session panel's transcript tail and files, and finished runs' answer excerpts.

const Id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200))

export const SessionDetailInput = Schema.Struct({ sessionID: Id })

export type SessionDetailInput = typeof SessionDetailInput.Type

export const SessionSummaryInput = Schema.Struct({
  sessionID: Id,
  idle: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))
})

export type SessionSummaryInput = typeof SessionSummaryInput.Type

export type SessionReadError = ActionError | OpenCodeUnavailableError | OpenCodeRequestError

/** Newest messages read for the session panel. */
const panelMessages = 30

/** Newest assistant messages searched for the latest answer. */
const answerMessages = 5

/** A diff failure (e.g. a range spanning a location change) only hides the file list. */
const optionalDiff = (files: Effect.Effect<ReadonlyArray<FileChange>, ActionError>) =>
  files.pipe(
    Effect.map(Option.some),
    Effect.catch(error =>
      Effect.logWarning('Session diff unavailable', error._tag).pipe(Effect.as(Option.none()))
    )
  )

export const totals = (files: ReadonlyArray<FileChange>): ChangeTotals => ({
  files: files.length,
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0)
})

/** The session panel's data: transcript tail and the latest turn's changed files. */
export const loadSessionDetail = (input: SessionDetailInput) =>
  withConnection(connection =>
    Effect.all(
      {
        transcript: connection.transcript({
          sessionID: input.sessionID,
          limit: panelMessages,
          assistantOnly: false
        }),
        files: optionalDiff(connection.diff({ sessionID: input.sessionID }))
      },
      { concurrency: 2 }
    ).pipe(
      Effect.map(({ transcript, files }): SessionDetail => ({
        sessionID: input.sessionID,
        transcript,
        files: Option.getOrUndefined(files)
      }))
    )
  )

/** A finished run's answer excerpt and change totals (uncached). */
export const loadSessionSummary = (input: SessionSummaryInput) =>
  withConnection(connection =>
    Effect.all(
      {
        transcript: connection.transcript({
          sessionID: input.sessionID,
          limit: answerMessages,
          assistantOnly: true
        }),
        files: optionalDiff(connection.diff({ sessionID: input.sessionID }))
      },
      { concurrency: 2 }
    ).pipe(
      Effect.map(({ transcript, files }): SessionSummary => ({
        sessionID: input.sessionID,
        idle: input.idle,
        answer: transcript.answer,
        changes: Option.getOrUndefined(Option.map(files, totals))
      }))
    )
  )

class SummaryKey extends Data.Class<{ readonly sessionID: string; readonly idle: number }> {}

export type SessionSummariesOperations = {
  readonly get: (input: SessionSummaryInput) => Effect.Effect<SessionSummary, SessionReadError>
}

/**
 * Finished-run summaries, cached in the runtime by `(sessionID, idle)`. A run's answer and files
 * are fixed once it is idle, and the next run has a new `idle`, so entries never need
 * invalidation; failures are not cached. (An Effect `Cache`, not `'use cache'`: nothing for the
 * watcher to invalidate, and failed OpenCode reads must never be stored.)
 */
export class SessionSummaries extends Context.Service<
  SessionSummaries,
  SessionSummariesOperations
>()('@fleet/SessionSummaries') {}

export const summaryCapacity = 500

export const SessionSummariesLive = Layer.effect(
  SessionSummaries,
  Effect.gen(function* () {
    const opencode = yield* OpenCode

    const cache = yield* Cache.makeWith(
      (key: SummaryKey) =>
        loadSessionSummary({ sessionID: key.sessionID, idle: key.idle }).pipe(
          Effect.provideService(OpenCode, opencode)
        ),
      {
        capacity: summaryCapacity,
        timeToLive: exit => (Exit.isSuccess(exit) ? '1 day' : 0)
      }
    )

    return {
      get: input =>
        Cache.get(cache, new SummaryKey({ sessionID: input.sessionID, idle: input.idle }))
    }
  })
)
