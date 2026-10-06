import { Cache, Clock, Context, Data, DateTime, Effect, Exit, Layer, Option, Schema } from 'effect'
import { StatsRangeError } from '@/lib/data/fleet/errors'
import { calendarDayParts, StatsPeriod } from '@/lib/data/fleet/stats-period'
import { projectSeriesLimit } from '@/lib/data/fleet/stats-view'
import type { StatsPreset } from '@/lib/data/fleet/stats-period'
import { HoursRead, HoursTooLong } from '@/lib/data/fleet/types'
import type {
  SessionStats,
  StatsBucket,
  StatsHours,
  PromptsByProject,
  StatsCalendar,
  StatsReport,
  StatsUnit
} from '@/lib/data/fleet/types'
import type { OpenCodeRequestError, OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection, RejectableError } from '@/lib/services/opencode/service'

// The Stats tab's data (`GET /api/fleet/stats`): OpenCode's own stats, for the whole range and per
// bucket, with no state of Fleet's. Buckets that ended a while ago are cached in the runtime, so
// a range's bars are read from OpenCode once.

/** An IANA time zone (`Europe/Madrid`): the browser's, which days and hours follow. */
export const TimeZoneName = Schema.String.check(
  Schema.makeFilter(
    value => Option.isSome(DateTime.zoneMakeNamed(value)) || 'Expected an IANA time zone'
  )
)

const Id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200))

/** The query besides the period (`stats-period.ts`): the time zone and an OpenCode project. */
export const StatsQueryParams = Schema.Struct({
  timezone: TimeZoneName,
  project: Schema.optional(Id)
})

export type StatsQuery = {
  readonly period: StatsPeriod
  readonly timezone: string
  /** OpenCode's project id (`global` for sessions outside any repository); all when absent. */
  readonly project: string | undefined
}

/** `[from, to)` in epoch ms; `from` is absent for all time (OpenCode's first message). */
export type StatsWindow = { readonly from: number | undefined; readonly to: number }

const hour = 60 * 60 * 1000

const presetDays: Readonly<Record<Exclude<StatsPreset, '24h' | 'all'>, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90
}

const zoned = (millis: number, zone: DateTime.TimeZone) =>
  DateTime.makeZonedUnsafe(millis, { timeZone: zone })

/** The start of a calendar day in `zone` (`calendarDayParts` checked it is a real day). */
const dayStart = (day: string, zone: DateTime.TimeZone): Option.Option<DateTime.Zoned> =>
  Option.flatMap(calendarDayParts(day), parts =>
    DateTime.makeZoned(parts, { timeZone: zone, adjustForTimeZone: true })
  )

/**
 * The window a period covers at `now`: `24h` the last 24 hours; `7d` / `30d` / `90d` today and the
 * days before it, from midnight; days from the first's midnight to the end of the last (or now).
 * None for days that are not real.
 */
export const periodWindow = (
  period: StatsPeriod,
  now: number,
  zone: DateTime.TimeZone
): Option.Option<StatsWindow> =>
  StatsPeriod.$match(period, {
    Preset: ({ preset }) => {
      switch (preset) {
        case '24h':
          return Option.some({ from: now - 24 * hour, to: now })
        case 'all':
          return Option.some({ from: undefined, to: now })
        default: {
          const today = DateTime.startOf(zoned(now, zone), 'day')
          const first = DateTime.subtract(today, { days: presetDays[preset] - 1 })

          return Option.some({ from: DateTime.toEpochMillis(first), to: now })
        }
      }
    },
    Days: ({ from, to }) =>
      Option.map(Option.all([dayStart(from, zone), dayStart(to, zone)]), ([first, last]) => ({
        from: DateTime.toEpochMillis(first),
        to: Math.min(now, DateTime.toEpochMillis(DateTime.add(last, { days: 1 })))
      }))
  })

/** Hours up to two days, days up to 92 (a DST hour of slack), then weeks. */
export const statsUnit = (from: number, to: number): StatsUnit =>
  to - from <= 48 * hour ? 'hour' : to - from <= (92 * 24 + 1) * hour ? 'day' : 'week'

const unitStep: Readonly<Record<StatsUnit, Partial<DateTime.DateTime.PartsForMath>>> = {
  hour: { hours: 1 },
  day: { days: 1 },
  week: { weeks: 1 }
}

export type BucketEdges = { readonly start: number; readonly end: number }

/**
 * `[from, to)` cut at every `unit` boundary in `zone` (weeks start on Monday); the first and last
 * buckets are clipped to the window. None for an empty window.
 */
export const statsBuckets = (
  from: number,
  to: number,
  unit: StatsUnit,
  zone: DateTime.TimeZone
): ReadonlyArray<BucketEdges> => {
  const buckets: Array<BucketEdges> = []

  if (from >= to) return buckets

  let edge = DateTime.startOf(zoned(from, zone), unit, { weekStartsOn: 1 })

  while (DateTime.toEpochMillis(edge) < to) {
    const next = DateTime.add(edge, unitStep[unit])

    buckets.push({
      start: Math.max(from, DateTime.toEpochMillis(edge)),
      end: Math.min(to, DateTime.toEpochMillis(next))
    })
    edge = next
  }

  return buckets
}

/** No activity in `[from, to)`. */
export const noActivity = (from: number, to: number): SessionStats => ({
  from,
  to,
  sessions: 0,
  subagents: 0,
  prompts: 0,
  steps: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  activeDays: 0,
  streak: 0,
  toolTotals: { calls: 0, succeeded: 0, failed: 0, unfinished: 0 },
  tools: [],
  models: [],
  activity: []
})

const toBucket = (edges: BucketEdges, stats: SessionStats): StatsBucket => ({
  start: edges.start,
  end: edges.end,
  sessions: stats.sessions,
  subagents: stats.subagents,
  prompts: stats.prompts,
  steps: stats.steps,
  tokens: stats.tokens,
  tools: stats.toolTotals,
  models: stats.models
})

/**
 * A bucket that ended this long ago is settled: a step's tokens land when it ends, so a bucket
 * still changes while a step that started in it runs.
 */
export const settledAfter = 10 * 60 * 1000

class BucketKey extends Data.Class<{
  readonly start: number
  readonly end: number
  readonly project: string | undefined
}> {}

/** The connection a report reads its buckets through (one per report). */
class StatsSource extends Context.Service<StatsSource, OpenCodeConnection>()(
  '@fleet/StatsSource'
) {}

const readBucket = (connection: OpenCodeConnection, key: BucketKey, timezone: string) =>
  connection.stats({
    from: key.start,
    to: key.end,
    projectID: key.project,
    timezone,
    tools: 'summary'
  })

export type StatsError = RejectableError | OpenCodeUnavailableError | OpenCodeRequestError

export type StatsOperations = {
  readonly report: (query: StatsQuery) => Effect.Effect<StatsReport, StatsError | StatsRangeError>
  /** Prompts per hour for the time-of-day charts; `TooLong` past `hoursLimit` or for all time. */
  readonly hours: (query: StatsQuery) => Effect.Effect<StatsHours, StatsError | StatsRangeError>
  /** Prompts per bar, of all projects and the top five; the query's project is ignored. */
  readonly promptsByProject: (
    query: StatsQuery
  ) => Effect.Effect<PromptsByProject, StatsError | StatsRangeError>
  /** Steps per day over the last 53 weeks; the query's period is ignored. */
  readonly calendar: (
    query: StatsQuery
  ) => Effect.Effect<StatsCalendar, StatsError | StatsRangeError>
}

export class Stats extends Context.Service<Stats, StatsOperations>()('@fleet/Stats') {}

/** Settled buckets kept: a month of hours and a year of days for a few projects. */
export const bucketCapacity = 5000

/** The calendar's weeks: a year and the current week. */
export const calendarWeeks = 53

/** Bucket reads in flight per report. */
const bucketConcurrency = 4

/**
 * The longest range read hour by hour (31 days and a DST hour: 745 small calls, a few tenths of a
 * second of OpenCode's time per day of range the first time; settled hours are cached).
 */
export const hoursLimit = (31 * 24 + 1) * hour

const tooLong: StatsHours = HoursTooLong.make({})

export const StatsLive = Layer.effect(
  Stats,
  Effect.gen(function* () {
    const opencode = yield* OpenCode

    // Settled buckets never change; failures are not kept. A bucket's numbers do not depend on
    // the time zone (only its edges do), so the key leaves it out.
    const settled = yield* Cache.makeWith(
      (key: BucketKey) =>
        Effect.flatMap(StatsSource, connection => readBucket(connection, key, 'UTC')),
      {
        capacity: bucketCapacity,
        timeToLive: exit => (Exit.isSuccess(exit) ? '1 day' : 0),
        requireServicesAt: 'lookup'
      }
    )

    /** The query's zone and window at `now`, or a range error. */
    const resolve = (query: StatsQuery, now: number) => {
      const zone = DateTime.zoneMakeNamed(query.timezone)
      const window = Option.flatMap(zone, value => periodWindow(query.period, now, value))

      return Option.isSome(zone) && Option.isSome(window)
        ? Effect.succeed({ zone: zone.value, window: window.value })
        : Effect.fail(new StatsRangeError({ timezone: query.timezone }))
    }

    /** Each bucket's stats: settled ones through the cache, the rest from OpenCode. */
    const readBuckets = (
      connection: OpenCodeConnection,
      edges: ReadonlyArray<BucketEdges>,
      query: StatsQuery,
      now: number
    ) =>
      Effect.forEach(
        edges,
        bucket => {
          const key = new BucketKey({
            start: bucket.start,
            end: bucket.end,
            project: query.project
          })

          const read =
            bucket.end <= now - settledAfter
              ? Cache.get(settled, key)
              : readBucket(connection, key, query.timezone)

          return Effect.map(read, stats => ({ edges: bucket, stats }))
        },
        { concurrency: bucketConcurrency }
      ).pipe(Effect.provideService(StatsSource, connection))

    const report = (query: StatsQuery) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const { zone, window } = yield* resolve(query, now)
        const { from, to } = window

        if (from !== undefined && from >= to) {
          const nothing: StatsReport = {
            from,
            to: from,
            unit: 'day',
            timezone: query.timezone,
            totals: noActivity(from, from),
            buckets: []
          }

          return nothing
        }

        const connection = yield* opencode.connect

        // All time for a project without messages is an empty range, which OpenCode refuses.
        const totals = yield* connection
          .stats({ from, to, projectID: query.project, timezone: query.timezone, tools: 'detail' })
          .pipe(
            Effect.catchTag('OpenCodeRejectedError', error =>
              from === undefined ? Effect.succeed(noActivity(to, to)) : Effect.fail(error)
            )
          )

        const unit = statsUnit(totals.from, to)

        const buckets = yield* readBuckets(
          connection,
          statsBuckets(totals.from, to, unit, zone),
          query,
          now
        )

        // The as long range before, through the cache (it ended at `from`); none for all time.
        const previous =
          from === undefined
            ? undefined
            : yield* Cache.get(
                settled,
                new BucketKey({ start: from - (to - from), end: from, project: query.project })
              ).pipe(Effect.provideService(StatsSource, connection))

        const result: StatsReport = {
          from: totals.from,
          to,
          unit,
          timezone: query.timezone,
          totals,
          previous,
          buckets: buckets.map(({ edges, stats }) => toBucket(edges, stats))
        }

        return result
      })

    // The same buckets as a report by the hour, so a 24h report and these share the cache.
    const hours = (query: StatsQuery) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const { zone, window } = yield* resolve(query, now)
        const { from, to } = window

        if (from === undefined || to - from > hoursLimit) return tooLong

        const edges = statsBuckets(from, to, 'hour', zone)

        const read =
          edges.length === 0 ? [] : yield* readBuckets(yield* opencode.connect, edges, query, now)

        const result: StatsHours = HoursRead.make({
          from,
          to: Math.max(from, to),
          timezone: query.timezone,
          hours: read.map(({ edges: bucket, stats }) => ({
            start: bucket.start,
            prompts: stats.prompts
          }))
        })

        return result
      })

    // Projects ranked by one small call each (no tools), then the top ones' bars and all
    // projects' bars, all through the bucket cache (the latter are the unfiltered report's).
    const promptsByProject = (query: StatsQuery) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const { zone, window } = yield* resolve(query, now)
        const { from, to } = window

        if (from !== undefined && from >= to) {
          const nothing: PromptsByProject = {
            from,
            to: from,
            unit: 'day',
            timezone: query.timezone,
            buckets: [],
            projects: []
          }

          return nothing
        }

        const connection = yield* opencode.connect
        const known = yield* connection.projects

        const ranked = yield* Effect.forEach(
          known,
          project =>
            connection
              .stats({ from, to, projectID: project.id, timezone: query.timezone, tools: 'none' })
              .pipe(
                // All time for a project without messages is an empty range, which OpenCode refuses.
                Effect.catchTag('OpenCodeRejectedError', error =>
                  from === undefined ? Effect.succeed(noActivity(to, to)) : Effect.fail(error)
                ),
                Effect.map(stats => ({
                  projectID: project.id,
                  prompts: stats.prompts,
                  from: stats.from
                }))
              ),
          { concurrency: bucketConcurrency }
        )

        // All time starts at the first project's first message.
        const start = from ?? Math.min(to, ...ranked.map(project => project.from))
        const unit = statsUnit(start, to)
        const edges = statsBuckets(start, to, unit, zone)

        const top = ranked
          .filter(project => project.prompts > 0)
          .toSorted((left, right) => right.prompts - left.prompts)
          .slice(0, projectSeriesLimit)

        const all = yield* readBuckets(connection, edges, { ...query, project: undefined }, now)

        const projects = yield* Effect.forEach(top, project =>
          Effect.map(
            readBuckets(connection, edges, { ...query, project: project.projectID }, now),
            read => ({
              projectID: project.projectID,
              prompts: read.map(({ stats }) => stats.prompts)
            })
          )
        )

        const result: PromptsByProject = {
          from: start,
          to,
          unit,
          timezone: query.timezone,
          buckets: all.map(({ edges: bucket, stats }) => ({
            start: bucket.start,
            end: bucket.end,
            prompts: stats.prompts
          })),
          projects
        }

        return result
      })

    // One call for a year of days (OpenCode counts steps per day in the query's zone).
    const calendar = (query: StatsQuery) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const zone = DateTime.zoneMakeNamed(query.timezone)

        if (Option.isNone(zone)) return yield* new StatsRangeError({ timezone: query.timezone })

        const today = DateTime.startOf(zoned(now, zone.value), 'day')

        const from = DateTime.toEpochMillis(
          DateTime.startOf(DateTime.subtract(today, { weeks: calendarWeeks - 1 }), 'week', {
            weekStartsOn: 1
          })
        )

        const connection = yield* opencode.connect

        const stats = yield* connection
          .stats({
            from,
            to: now,
            projectID: query.project,
            timezone: query.timezone,
            tools: 'none'
          })
          .pipe(
            Effect.catchTag('OpenCodeRejectedError', () => Effect.succeed(noActivity(from, now)))
          )

        const result: StatsCalendar = {
          from,
          to: now,
          timezone: query.timezone,
          days: stats.activity
        }

        return result
      })

    return { report, hours, promptsByProject, calendar }
  })
)
