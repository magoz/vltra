import { describe, expect, it } from '@effect/vitest'
import { DateTime, Effect, Option, Schema } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import {
  noActivity,
  periodWindow,
  settledAfter,
  Stats,
  StatsLive,
  statsBuckets,
  statsUnit
} from '@/lib/data/vltra/stats'
import { StatsPeriod } from '@/lib/data/vltra/stats-period'
import { HoursRead, HoursTooLong } from '@/lib/data/vltra/types'
import type { SessionStats } from '@/lib/data/vltra/types'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeCall, FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import { OpenCodeRejectedError } from '@/lib/services/opencode/errors'
import type { StatsInput } from '@/lib/services/opencode/service'

const madrid = Option.getOrThrow(DateTime.zoneMakeNamed('Europe/Madrid'))

const hour = 60 * 60 * 1000

/** Tue Oct 6 2026, 12:30 in Madrid (UTC+2). */
const now = Date.UTC(2026, 9, 6, 10, 30)

/** Midnight in Madrid at the start of a day of October 2026 (before the 25th: UTC+2). */
const madridMidnight = (day: number) =>
  day <= 25 ? Date.UTC(2026, 9, day - 1, 22) : Date.UTC(2026, 9, day - 1, 23)

const preset = (value: '24h' | '7d' | '30d' | '90d' | 'all') =>
  StatsPeriod.Preset({ preset: value })

describe('stats windows', () => {
  it('cuts presets back from now: 24 hours, or today and the days before it from midnight', () => {
    expect(periodWindow(preset('24h'), now, madrid)).toEqual(
      Option.some({ from: now - 24 * hour, to: now })
    )

    // Oct 6 minus six days: Sep 30, 00:00 in Madrid.
    expect(periodWindow(preset('7d'), now, madrid)).toEqual(
      Option.some({ from: Date.UTC(2026, 8, 29, 22), to: now })
    )

    expect(periodWindow(preset('all'), now, madrid)).toEqual(
      Option.some({ from: undefined, to: now })
    )
  })

  it('days run from the first midnight to the end of the last, never past now', () => {
    expect(
      periodWindow(StatsPeriod.Days({ from: '2026-10-01', to: '2026-10-03' }), now, madrid)
    ).toEqual(Option.some({ from: madridMidnight(1), to: madridMidnight(4) }))

    expect(
      periodWindow(StatsPeriod.Days({ from: '2026-10-05', to: '2026-10-09' }), now, madrid)
    ).toEqual(Option.some({ from: madridMidnight(5), to: now }))

    expect(
      periodWindow(StatsPeriod.Days({ from: '2026-02-30', to: '2026-03-01' }), now, madrid)
    ).toEqual(Option.none())
  })

  it('picks hours up to two days, days up to 92, then weeks', () => {
    expect(statsUnit(0, 48 * hour)).toBe('hour')
    expect(statsUnit(0, 48 * hour + 1)).toBe('day')
    expect(statsUnit(0, 92 * 24 * hour)).toBe('day')
    expect(statsUnit(0, 93 * 24 * hour)).toBe('week')
  })

  it('cuts buckets at local boundaries, clipping the first and last', () => {
    expect(statsBuckets(now - 2 * hour, now, 'hour', madrid)).toEqual([
      { start: now - 2 * hour, end: Date.UTC(2026, 9, 6, 9) },
      { start: Date.UTC(2026, 9, 6, 9), end: Date.UTC(2026, 9, 6, 10) },
      { start: Date.UTC(2026, 9, 6, 10), end: now }
    ])

    expect(statsBuckets(madridMidnight(4), now, 'day', madrid)).toEqual([
      { start: madridMidnight(4), end: madridMidnight(5) },
      { start: madridMidnight(5), end: madridMidnight(6) },
      { start: madridMidnight(6), end: now }
    ])
  })

  it('a day across the DST change lasts 25 hours; weeks start on Monday', () => {
    const days = statsBuckets(madridMidnight(25), madridMidnight(27), 'day', madrid)

    expect(days.map(bucket => (bucket.end - bucket.start) / hour)).toEqual([25, 24])

    // Tue Oct 6 belongs to the week of Mon Oct 5.
    expect(statsBuckets(now - hour, now, 'week', madrid)).toEqual([{ start: now - hour, end: now }])
    expect(statsBuckets(madridMidnight(4), madridMidnight(6), 'week', madrid)).toEqual([
      { start: madridMidnight(4), end: madridMidnight(5) },
      { start: madridMidnight(5), end: madridMidnight(6) }
    ])
  })
})

/** OpenCode's answer: each call's own window, with as many steps as hours in it. */
const hourlySteps = (input: StatsInput): SessionStats => ({
  ...noActivity(input.from ?? Date.UTC(2026, 9, 5, 22), input.to),
  steps: Math.floor((input.to - (input.from ?? Date.UTC(2026, 9, 5, 22))) / hour)
})

const statsCalls = (fake: FakeOpenCode) =>
  Effect.map(fake.calls, calls =>
    calls.flatMap((call: FakeCall) => (call.op === 'stats' ? [call] : []))
  )

describe('stats reports', () => {
  const report = (period: StatsPeriod, project?: string) =>
    Effect.flatMap(Stats, stats => stats.report({ period, timezone: 'Europe/Madrid', project }))

  /**
   * A test at `at` over a fake OpenCode answering `hourlySteps`, with one `StatsLive` (one cache)
   * for the whole test.
   */
  const statsTest = <E>(
    name: string,
    body: (fake: FakeOpenCode) => Effect.Effect<void, E, Stats>,
    at = now
  ) =>
    it.effect(name, () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(at)

        const fake = yield* makeFakeOpenCode()

        yield* fake.setStats(input => Effect.succeed(hourlySteps(input)))
        yield* body(fake).pipe(Effect.provide(StatsLive), Effect.provide(fake.layer))
      })
    )

  statsTest('reads the totals in detail, then each bucket in summary', fake =>
    Effect.gen(function* () {
      const result = yield* report(preset('7d'), 'prj_vltra')

      expect(result.unit).toBe('day')
      expect(result.from).toBe(Date.UTC(2026, 8, 29, 22))
      expect(result.to).toBe(now)
      expect(result.timezone).toBe('Europe/Madrid')
      expect(result.buckets.map(bucket => bucket.steps)).toEqual([24, 24, 24, 24, 24, 24, 12])

      const calls = yield* statsCalls(fake)

      expect(calls[0]).toEqual({
        op: 'stats',
        from: Date.UTC(2026, 8, 29, 22),
        to: now,
        projectID: 'prj_vltra',
        timezone: 'Europe/Madrid',
        tools: 'detail'
      })

      expect(calls.slice(1).every(call => call.tools === 'summary')).toBe(true)
      expect(calls.slice(1).every(call => call.projectID === 'prj_vltra')).toBe(true)
      // Totals, seven days and the as long range before (for the tiles' change).
      expect(calls).toHaveLength(9)
      expect(result.previous?.to).toBe(Date.UTC(2026, 8, 29, 22))
      expect(result.previous?.from).toBe(
        Date.UTC(2026, 8, 29, 22) - (now - Date.UTC(2026, 8, 29, 22))
      )
    })
  )

  statsTest('reads settled buckets once; the current one every time', fake =>
    Effect.gen(function* () {
      yield* report(preset('7d'))

      const first = (yield* statsCalls(fake)).length

      yield* report(preset('7d'))

      // Totals and today's bucket again; the six settled days from the cache.
      expect((yield* statsCalls(fake)).length - first).toBe(2)

      // Another project is another set of buckets (and range before).
      yield* report(preset('7d'), 'prj_other')

      expect((yield* statsCalls(fake)).length - first).toBe(2 + 9)
    })
  )

  // Five minutes after an hour: the hour that just ended is too fresh to keep.
  statsTest(
    'a bucket that just ended is not cached until it settles',
    fake =>
      Effect.gen(function* () {
        yield* report(preset('24h'))
        yield* report(preset('24h'))

        const calls = yield* statsCalls(fake)
        const fresh = Date.UTC(2026, 9, 6, 10)

        expect(fresh > Date.UTC(2026, 9, 6, 10, 5) - settledAfter).toBe(true)
        expect(calls.filter(call => call.to === fresh)).toHaveLength(2)
        expect(calls.filter(call => call.to === Date.UTC(2026, 9, 6, 9))).toHaveLength(1)
      }),
    Date.UTC(2026, 9, 6, 10, 5)
  )

  statsTest("all time starts at OpenCode's first message; future days need no call", fake =>
    Effect.gen(function* () {
      const all = yield* report(preset('all'))

      // `hourlySteps` says OpenCode's first message was at Oct 6, 00:00.
      expect(all.from).toBe(Date.UTC(2026, 9, 5, 22))
      expect(all.unit).toBe('hour')
      expect(all.buckets).toHaveLength(13)

      const before = (yield* statsCalls(fake)).length

      const future = yield* report(StatsPeriod.Days({ from: '2026-10-08', to: '2026-10-09' }))

      expect(future.buckets).toEqual([])
      expect((yield* statsCalls(fake)).length).toBe(before)
    })
  )

  statsTest('all time for a project without messages is empty, not a failure', fake =>
    Effect.gen(function* () {
      yield* fake.setStats(input =>
        input.from === undefined
          ? Effect.fail(
              new OpenCodeRejectedError({
                operation: 'session.stats',
                message: 'Stats range must end after it starts'
              })
            )
          : Effect.succeed(hourlySteps(input))
      )

      const empty = yield* report(preset('all'), 'prj_quiet')

      expect(empty).toMatchObject({ from: now, to: now, buckets: [] })

      // A refused range of days is still an error.
      yield* fake.setStats(() =>
        Effect.fail(new OpenCodeRejectedError({ operation: 'session.stats', message: 'no' }))
      )

      const error = yield* Effect.flip(report(preset('7d')))

      expect(error._tag).toBe('OpenCodeRejectedError')
    })
  )

  statsTest('days that do not exist fail as a range error', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        report(StatsPeriod.Days({ from: '2026-02-30', to: '2026-03-01' }))
      )

      expect(error._tag).toBe('StatsRangeError')
    })
  )

  statsTest('reads prompts hour by hour up to 31 days, sharing settled hours', fake =>
    Effect.gen(function* () {
      const hours = yield* Effect.flatMap(Stats, stats =>
        stats.hours({ period: preset('7d'), timezone: 'Europe/Madrid', project: undefined })
      )

      if (!Schema.is(HoursRead)(hours)) return expect.unreachable('7 days fits')

      // Sep 30 00:00 to Oct 6 12:30 in Madrid: six days and 12.5 hours.
      expect(hours.hours).toHaveLength(6 * 24 + 13)
      expect(hours.hours[0]?.start).toBe(Date.UTC(2026, 8, 29, 22))

      const before = (yield* statsCalls(fake)).length

      // A 24h report's buckets are the same hours: only the totals, its first hour (clipped to
      // 10:30), the current one and the 24 hours before are read.
      yield* report(preset('24h'))

      expect((yield* statsCalls(fake)).length - before).toBe(1 + 2 + 1)
    })
  )

  statsTest('past 31 days, and for all time, hours are too long to read', fake =>
    Effect.gen(function* () {
      const read = (period: StatsPeriod) =>
        Effect.flatMap(Stats, stats =>
          stats.hours({ period, timezone: 'Europe/Madrid', project: undefined })
        )

      expect(Schema.is(HoursTooLong)(yield* read(preset('90d')))).toBe(true)
      expect(Schema.is(HoursTooLong)(yield* read(preset('all')))).toBe(true)
      expect(Schema.is(HoursRead)(yield* read(preset('30d')))).toBe(true)
      expect(
        Schema.is(HoursTooLong)(
          yield* read(StatsPeriod.Days({ from: '2026-09-01', to: '2026-10-02' }))
        )
      ).toBe(true)
      expect((yield* statsCalls(fake)).every(call => call.to - (call.from ?? 0) <= hour)).toBe(true)
    })
  )

  it.effect('splits prompts per bar by the three projects with most, whatever the filter', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(now)

      const ids = ['prj_a', 'prj_b', 'prj_c', 'prj_d', 'prj_e', 'prj_f', 'prj_quiet']

      const fake = yield* makeFakeOpenCode({
        ...emptySnapshot,
        projects: ids.map(id => ({ id, directory: `/${id}` }))
      })

      // Per hour of range: prj_a 1, prj_b 2, … prj_f 6, all together 30; prj_quiet has none.
      const rate = new Map(ids.slice(0, 6).map((id, index) => [id, index + 1]))

      yield* fake.setStats(input => {
        if (input.from === undefined && input.projectID === 'prj_quiet') {
          return Effect.fail(
            new OpenCodeRejectedError({ operation: 'session.stats', message: 'empty' })
          )
        }

        const from = input.from ?? now - 2 * hour
        const hours = Math.round((input.to - from) / hour)

        return Effect.succeed({
          ...noActivity(from, input.to),
          prompts:
            input.projectID === undefined ? 30 * hours : (rate.get(input.projectID) ?? 0) * hours
        })
      })

      const read = (period: StatsPeriod) =>
        Effect.flatMap(Stats, stats =>
          stats.promptsByProject({ period, timezone: 'Europe/Madrid', project: 'prj_a' })
        ).pipe(Effect.provide(StatsLive), Effect.provide(fake.layer))

      const day = yield* read(preset('24h'))

      expect(day.unit).toBe('hour')
      expect(day.buckets).toHaveLength(25)
      // A whole hour: 30 prompts from all projects; the top three by rank.
      expect(day.buckets[1]?.prompts).toBe(30)
      expect(day.projects.map(project => project.projectID)).toEqual(['prj_f', 'prj_e', 'prj_d'])
      expect(day.projects[0]?.prompts[1]).toBe(6)

      // All time: from the first project's first message; a project without any is just empty.
      const all = yield* read(preset('all'))

      expect(all.from).toBe(now - 2 * hour)
      expect(all.projects).toHaveLength(3)
    })
  )
})
