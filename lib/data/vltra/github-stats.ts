import { Cache, Clock, Context, Data, DateTime, Effect, Exit, Layer, Option } from 'effect'
import { StatsRangeError } from '@/lib/data/vltra/errors'
import { periodWindow, settledAfter } from '@/lib/data/vltra/stats'
import type { StatsError, StatsQuery } from '@/lib/data/vltra/stats'
import type { MergedPulls } from '@/lib/data/vltra/types'
import { GitHub } from '@/lib/services/github/service'
import type { GitHubUnavailableError, MergeWindow } from '@/lib/services/github/service'
import { OpenCode } from '@/lib/services/opencode/service'

// The Stats tab's GitHub cards (`GET /api/vltra/stats/github`): the user's merged pull requests
// for the range, whatever the project filter. Everything up to the start of today (UTC) is read
// once and cached in the runtime; today's are read again every time.

export type GitHubStatsError = GitHubUnavailableError | StatsError | StatsRangeError

export type GitHubStatsOperations = {
  /** The range's merged pull requests, oldest first, and the count of the range before. */
  readonly merged: (query: StatsQuery) => Effect.Effect<MergedPulls, GitHubStatsError>
}

export class GitHubStats extends Context.Service<GitHubStats, GitHubStatsOperations>()(
  '@vltra/GitHubStats'
) {}

const day = 24 * 60 * 60 * 1000

/** Ranges' settled parts kept (a few ranges' worth for a day). */
const settledCapacity = 64

class SettledKey extends Data.Class<{ readonly from: number; readonly to: number }> {}

/**
 * Where the settled part of a range ends at `now`: the start of the UTC day a while ago (merges
 * show up in GitHub's search after a delay, so the end of yesterday waits a little too).
 */
export const settledEdge = (now: number) => Math.floor((now - settledAfter) / day) * day

export const GitHubStatsLive = Layer.effect(
  GitHubStats,
  Effect.gen(function* () {
    const github = yield* GitHub
    const opencode = yield* OpenCode

    const settled = yield* Cache.makeWith(
      (key: SettledKey) => github.merged({ from: key.from, to: key.to }),
      {
        capacity: settledCapacity,
        timeToLive: exit => (Exit.isSuccess(exit) ? '1 day' : 0)
      }
    )

    /** All time starts at OpenCode's first message, as the report's does. */
    const firstMessage = (to: number, timezone: string) =>
      Effect.gen(function* () {
        const connection = yield* opencode.connect

        return yield* connection
          .stats({ from: undefined, to, projectID: undefined, timezone, tools: 'none' })
          .pipe(
            Effect.map(stats => stats.from),
            // No messages at all: an empty range, which OpenCode refuses.
            Effect.catchTag('OpenCodeRejectedError', () => Effect.succeed(to))
          )
      })

    const read = ({ from, to }: MergeWindow, now: number) => {
      const edge = Math.max(from, Math.min(to, settledEdge(now)))

      return Effect.map(
        Effect.all(
          [
            edge > from
              ? Cache.get(settled, new SettledKey({ from, to: edge }))
              : Effect.succeed([]),
            github.merged({ from: edge, to })
          ],
          { concurrency: 2 }
        ),
        ([old, today]) =>
          [...old, ...today].toSorted((left, right) => left.mergedAt - right.mergedAt)
      )
    }

    const merged = (query: StatsQuery) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const zone = DateTime.zoneMakeNamed(query.timezone)
        const window = Option.flatMap(zone, value => periodWindow(query.period, now, value))

        if (Option.isNone(window)) {
          return yield* new StatsRangeError({ timezone: query.timezone })
        }

        const { to } = window.value
        const from = window.value.from ?? (yield* firstMessage(to, query.timezone))
        const range = { from: Math.min(from, to), to }

        const [pulls, previous] = yield* Effect.all(
          [
            read(range, now),
            window.value.from === undefined
              ? Effect.succeed(undefined)
              : github.mergedCount({ from: range.from - (range.to - range.from), to: range.from })
          ],
          { concurrency: 2 }
        )

        const result: MergedPulls = { ...range, pulls, previous }

        return result
      })

    return { merged }
  })
)
