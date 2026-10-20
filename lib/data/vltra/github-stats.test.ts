import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { GitHubStats, GitHubStatsLive, settledEdge } from '@/lib/data/vltra/github-stats'
import { noActivity } from '@/lib/data/vltra/stats'
import { StatsPeriod } from '@/lib/data/vltra/stats-period'
import { makeFakeGitHub } from '@/lib/services/github/testing/fake-github'
import type { FakeGitHub } from '@/lib/services/github/testing/fake-github'
import type { MergedPull } from '@/lib/services/github/service'
import { makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'

const hour = 60 * 60 * 1000

/** Tue Oct 6 2026, 12:30 in Madrid (UTC+2). */
const now = Date.UTC(2026, 9, 6, 10, 30)

/** Sep 30, 00:00 in Madrid: the 7d range's start. */
const weekStart = Date.UTC(2026, 8, 29, 22)

const pull = (number: number, mergedAt: number): MergedPull => ({
  repo: 'magoz/vltra',
  number,
  createdAt: mergedAt - hour,
  mergedAt
})

const pulls = [
  // The range before.
  pull(1, weekStart - 2 * hour),
  pull(2, weekStart + hour),
  pull(3, Date.UTC(2026, 9, 3, 12)),
  // Today (UTC), after the settled part.
  pull(4, Date.UTC(2026, 9, 6, 9))
]

const merged = (period: StatsPeriod) =>
  Effect.flatMap(GitHubStats, github =>
    github.merged({ period, timezone: 'Europe/Madrid', project: undefined })
  )

const preset = (value: '7d' | 'all') => StatsPeriod.Preset({ preset: value })

/** A test at `now` over a fake GitHub and OpenCode (its first message on Sep 1), one cache. */
const githubTest = <E>(
  name: string,
  body: (fake: FakeGitHub) => Effect.Effect<void, E, GitHubStats>
) =>
  it.effect(name, () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(now)

      const github = yield* makeFakeGitHub(pulls)
      const opencode = yield* makeFakeOpenCode()

      yield* opencode.setStats(input =>
        Effect.succeed(noActivity(input.from ?? Date.UTC(2026, 8, 1), input.to))
      )

      yield* body(github).pipe(
        Effect.provide(GitHubStatsLive),
        Effect.provide(github.layer),
        Effect.provide(opencode.layer)
      )
    })
  )

describe('GitHub stats', () => {
  it('settles at the start of the UTC day, a while after midnight', () => {
    expect(settledEdge(now)).toBe(Date.UTC(2026, 9, 6))
    expect(settledEdge(Date.UTC(2026, 9, 6, 0, 5))).toBe(Date.UTC(2026, 9, 5))
  })

  githubTest('reads the range’s merged PRs, oldest first, and counts the range before', fake =>
    Effect.gen(function* () {
      const result = yield* merged(preset('7d'))

      expect(result.from).toBe(weekStart)
      expect(result.to).toBe(now)
      expect(result.pulls.map(entry => entry.number)).toEqual([2, 3, 4])
      expect(result.previous).toBe(1)

      expect(yield* fake.calls).toEqual(
        expect.arrayContaining([
          { op: 'merged', from: weekStart, to: Date.UTC(2026, 9, 6) },
          { op: 'merged', from: Date.UTC(2026, 9, 6), to: now },
          { op: 'mergedCount', from: weekStart - (now - weekStart), to: weekStart }
        ])
      )
    })
  )

  githubTest('reads the settled part once; today’s every time', fake =>
    Effect.gen(function* () {
      yield* merged(preset('7d'))
      yield* merged(preset('7d'))

      const calls = (yield* fake.calls).filter(call => call.op === 'merged')

      expect(calls.filter(call => call.from === weekStart)).toHaveLength(1)
      expect(calls.filter(call => call.from === Date.UTC(2026, 9, 6))).toHaveLength(2)
    })
  )

  githubTest('all time starts at OpenCode’s first message, with no range before', fake =>
    Effect.gen(function* () {
      const result = yield* merged(preset('all'))

      expect(result.from).toBe(Date.UTC(2026, 8, 1))
      expect(result.pulls.map(entry => entry.number)).toEqual([1, 2, 3, 4])
      expect(result.previous).toBeUndefined()
      expect((yield* fake.calls).some(call => call.op === 'mergedCount')).toBe(false)
    })
  )

  githubTest('passes GitHub’s failure on, and keeps no failed read', fake =>
    Effect.gen(function* () {
      yield* fake.setFailure('gh is not signed in')

      const failure = yield* Effect.flip(merged(preset('7d')))

      expect(failure._tag).toBe('GitHubUnavailableError')

      yield* fake.setFailure(undefined)

      expect((yield* merged(preset('7d'))).pulls).toHaveLength(3)
    })
  )

  githubTest('refuses days that are not real', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        merged(StatsPeriod.Days({ from: '2026-02-30', to: '2026-03-01' }))
      )

      expect(failure._tag).toBe('StatsRangeError')
    })
  )
})
