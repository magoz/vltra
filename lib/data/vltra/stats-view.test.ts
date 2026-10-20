import { describe, expect, it } from '@effect/vitest'
import { fromSnapshot, otherProjectID } from '@/lib/data/vltra/board'
import type { LiveVltra } from '@/lib/data/vltra/board'
import { fromSnapshot as modelFromSnapshot } from '@/lib/data/vltra/model'
import { buildSnapshot } from '@/lib/data/vltra/snapshot'
import { noActivity } from '@/lib/data/vltra/stats'
import {
  cacheHitRatio,
  calendarGrid,
  changePercent,
  doneByDay,
  doneCount,
  doneOverTime,
  freshTokens,
  hourGrid,
  inkLevel,
  medianMergeTime,
  mergedByDay,
  mergedByRepo,
  mergeTimes,
  modelShare,
  outcomesOverTime,
  promptPoints,
  promptProjectKeys,
  promptsByProjectChart,
  repoCount,
  restKey,
  runOutcomes,
  sessionLengths,
  sessionPoints,
  sessionStartPoints,
  sessionsStarted,
  statsProjectID,
  stepsPerPrompt,
  subagentCounts,
  tileSeries,
  toolFailureRate,
  yearWeeks,
  tokensByModel,
  toolCalls
} from '@/lib/data/vltra/stats-view'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type {
  MergedPullRequest,
  ModelUsage,
  PromptsByProject,
  SessionRecord,
  StatsBucket,
  StatsReport
} from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const hour = 60 * 60 * 1000

const box = '/home/me/dev/repos/box'

const liveOf = (sessions: ReadonlyArray<SessionRecord>): LiveVltra =>
  fromSnapshot(
    buildSnapshot(
      modelFromSnapshot(
        {
          ...emptySnapshot,
          sessions,
          projects: [
            { id: 'prj_vltra', name: 'vltra', directory: '/home/me/dev/repos/vltra' },
            { id: 'prj_box', name: 'box', directory: box },
            { id: 'global', directory: '/' }
          ]
        },
        baseTime
      ),
      {
        connection: { status: 'connected', since: baseTime, failures: 0 },
        webUrl,
        now: baseTime + 10 * hour
      }
    )
  )

const model = (name: string, output: number, cacheRead = 0): ModelUsage => ({
  model: name,
  steps: 1,
  tokens: { input: 0, output, reasoning: 0, cacheRead, cacheWrite: 0 }
})

const bucket = (index: number, overrides: Partial<StatsBucket> = {}): StatsBucket => {
  const empty = noActivity(baseTime + index * hour, baseTime + (index + 1) * hour)

  return {
    start: empty.from,
    end: empty.to,
    sessions: 0,
    subagents: 0,
    prompts: 0,
    steps: 0,
    tokens: empty.tokens,
    tools: empty.toolTotals,
    models: [],
    ...overrides
  }
}

const toolsOf = (calls: number, failed: number) => ({
  calls,
  succeeded: calls - failed,
  failed,
  unfinished: 0
})

const reportOf = (buckets: ReadonlyArray<StatsBucket>): StatsReport => ({
  from: baseTime,
  to: baseTime + buckets.length * hour,
  unit: 'hour',
  timezone: 'UTC',
  totals: noActivity(baseTime, baseTime + buckets.length * hour),
  buckets
})

describe('stats charts', () => {
  it('counts every token but cache reads', () => {
    expect(freshTokens({ input: 1, output: 2, reasoning: 3, cacheRead: 1000, cacheWrite: 4 })).toBe(
      10
    )
  })

  it('stacks the models with most tokens, the rest summed', () => {
    const chart = tokensByModel(
      reportOf([
        bucket(0, { models: [model('a', 50), model('b', 40), model('c', 5, 9000)] }),
        bucket(1, { models: [model('b', 20), model('d', 1)] })
      ]),
      2
    )

    expect(chart.series).toEqual([
      { key: 'b', name: 'b' },
      { key: 'a', name: 'a' },
      { key: restKey, name: 'rest' }
    ])

    expect(chart.rows.map(row => row.values)).toEqual([
      [40, 50, 5],
      [20, 0, 1]
    ])
  })

  it('tool calls by status per bucket', () => {
    const chart = toolCalls(
      reportOf([bucket(0, { tools: { calls: 5, succeeded: 3, failed: 1, unfinished: 1 } })])
    )

    expect(chart.series.map(series => series.key)).toEqual(['succeeded', 'failed', 'unfinished'])
    expect(chart.rows[0]?.values).toEqual([3, 1, 1])
  })

  const live = liveOf([
    sessionRecord('ses_a', { created: baseTime + 10 }),
    sessionRecord('ses_b', { created: baseTime + hour + 10, idle: baseTime + hour + 20 }),
    sessionRecord('ses_box', {
      projectID: 'prj_box',
      directory: box,
      created: baseTime + hour,
      idle: baseTime + 90 * 60 * 1000,
      outcome: 'failed'
    }),
    sessionRecord('ses_tmp', {
      projectID: 'global',
      directory: '/tmp/x',
      created: baseTime + 30,
      idle: baseTime + 40,
      outcome: 'interrupted'
    }),
    sessionRecord('ses_old', { created: baseTime - hour, idle: baseTime - 10, outcome: 'failed' })
  ])

  const report = reportOf([bucket(0), bucket(1)])

  it('counts root sessions started in the range', () => {
    expect(sessionsStarted(live, report, undefined)).toBe(4)
    expect(sessionsStarted(live, report, 'prj_box')).toBe(1)
  })

  it('tallies how latest runs that ended in range ended', () => {
    // `ses_b` ended without an outcome (never ran to the end): not counted; `ses_old` before.
    expect(runOutcomes(live, report, undefined)).toEqual({
      succeeded: 0,
      failed: 1,
      interrupted: 1
    })

    expect(runOutcomes(live, report, otherProjectID)).toEqual({
      succeeded: 0,
      failed: 0,
      interrupted: 1
    })
  })

  it("asks OpenCode for the filter's project; Other is the global project", () => {
    expect(statsProjectID(live, undefined)).toBeUndefined()
    expect(statsProjectID(live, 'prj_box')).toBe('prj_box')
    expect(statsProjectID(live, otherProjectID)).toBe('global')
  })

  it('counts by weekday and hour in the report zone', () => {
    // Tue Oct 6 2026: 12:00 UTC is 14:00 in Madrid; 23:30 UTC is already Wednesday there.
    const grid = hourGrid(
      [
        { at: Date.UTC(2026, 9, 6, 12), count: 3 },
        { at: Date.UTC(2026, 9, 6, 12, 40), count: 2 },
        { at: Date.UTC(2026, 9, 6, 23, 30), count: 1 },
        { at: Date.UTC(2026, 9, 7, 2), count: 0 }
      ],
      'Europe/Madrid'
    )

    expect(grid.total).toBe(6)
    expect(grid.cells[1]?.[14]).toBe(5)
    expect(grid.cells[2]?.[1]).toBe(1)
    expect(grid.byHour[14]).toBe(5)
    expect(grid.byHour.reduce((sum, value) => sum + value, 0)).toBe(6)
    expect(grid.cells.map(row => row.length)).toEqual([24, 24, 24, 24, 24, 24, 24])
  })

  it('counts sessions started for ranges too long to read by the hour', () => {
    expect(sessionStartPoints(live, report, 'prj_box')).toEqual([{ at: baseTime + hour, count: 1 }])
    expect(promptPoints([{ start: 5, prompts: 2 }])).toEqual([{ at: 5, count: 2 }])
  })

  const byProject: PromptsByProject = {
    from: baseTime,
    to: baseTime + 2 * hour,
    unit: 'hour',
    timezone: 'UTC',
    buckets: [
      { start: baseTime, end: baseTime + hour, prompts: 10 },
      { start: baseTime + hour, end: baseTime + 2 * hour, prompts: 4 }
    ],
    projects: [
      { projectID: 'prj_vltra', prompts: [6, 1] },
      { projectID: 'global', prompts: [1, 3] }
    ]
  }

  it('stacks prompts by the top projects, Other for the global one, then the rest', () => {
    const chart = promptsByProjectChart(live, byProject)

    expect(chart.series).toEqual([
      { key: 'prj_vltra', name: 'vltra' },
      { key: otherProjectID, name: 'Other' },
      { key: restKey, name: 'rest' }
    ])

    expect(chart.rows.map(row => row.values)).toEqual([
      [6, 1, 3],
      [1, 3, 0]
    ])
  })

  it('feeds the tiles: per-bar values and the change against the range before', () => {
    const series = tileSeries(
      reportOf([
        bucket(0, { sessions: 2, prompts: 3, steps: 30, tools: toolsOf(10, 1) }),
        bucket(1, { sessions: 1, prompts: 1, steps: 5, tools: toolsOf(4, 0) })
      ])
    )

    expect(series.prompts).toEqual([3, 1])
    expect(series.steps).toEqual([30, 5])
    expect(series.toolCalls).toEqual([10, 4])
    expect(changePercent(150, 100)).toBe(50)
    expect(changePercent(5, 0)).toBeUndefined()
    expect(changePercent(5, undefined)).toBeUndefined()
  })

  it('turns bars into ratios: steps per prompt, cache hits, tool failures, model shares', () => {
    const ratios = reportOf([
      bucket(0, {
        prompts: 4,
        steps: 30,
        tokens: { input: 10, output: 0, reasoning: 0, cacheRead: 80, cacheWrite: 10 },
        tools: toolsOf(20, 5),
        models: [model('a', 30), model('b', 10)]
      }),
      bucket(1)
    ])

    expect(stepsPerPrompt(ratios).rows.map(row => row.values)).toEqual([[7.5], [0]])
    expect(cacheHitRatio(ratios).rows.map(row => row.values)).toEqual([[80], [0]])
    expect(toolFailureRate(ratios).rows.map(row => row.values)).toEqual([[25], [0]])
    expect(modelShare(ratios).rows.map(row => row.values)).toEqual([
      [75, 25],
      [0, 0]
    ])
  })

  it('counts how latest runs ended per bar of their end', () => {
    const chart = outcomesOverTime(live, report, undefined)

    expect(chart.series.map(series => series.key)).toEqual(['succeeded', 'failed', 'interrupted'])
    // ses_tmp was interrupted in the first hour, ses_box failed in the second.
    expect(chart.rows.map(row => row.values)).toEqual([
      [0, 0, 1],
      [0, 1, 0]
    ])
  })

  it('bins sessions started by how long they stayed open, leaving out ones that never ran', () => {
    const lengths = sessionLengths(live, report, undefined)

    expect(lengths.find(bin => bin.label === '<1m')?.count).toBe(2)
    expect(lengths.find(bin => bin.label === '30m–1h')?.count).toBe(1)
    expect(lengths.reduce((sum, bin) => sum + bin.count, 0)).toBe(3)
  })

  const withSubagents = liveOf([
    sessionRecord('ses_root', { created: baseTime + 10, idle: baseTime + 60_000, tokens: 100 }),
    sessionRecord('ses_child_1', { parentID: 'ses_root', created: baseTime + 20, tokens: 40 }),
    sessionRecord('ses_child_2', { parentID: 'ses_root', created: baseTime + 30, tokens: 2 }),
    sessionRecord('ses_alone', { created: baseTime + 40, idle: baseTime + 50, tokens: 0 })
  ])

  it('bins sessions started by their subagents, and sums their tokens into the scatter', () => {
    const counts = subagentCounts(withSubagents, report, undefined)

    expect(counts.find(bin => bin.label === '0')?.count).toBe(1)
    expect(counts.find(bin => bin.label === '2')?.count).toBe(1)

    expect(sessionPoints(withSubagents, report, undefined)).toEqual([
      expect.objectContaining({ id: 'ses_root', tokens: 142, length: 60_000 - 10 }),
      // Log scales: at least a second and a token.
      expect.objectContaining({ id: 'ses_alone', tokens: 1, length: 1000 })
    ])
  })

  it('lays a calendar out in weeks from Monday, up to today, across a DST change', () => {
    // Mon Oct 19 to Wed Oct 28 2026 in Madrid (summer time ends Sun Oct 25).
    const weeks = calendarGrid(
      new Map([
        ['2026-10-25', 7],
        ['2026-10-28', 3]
      ]),
      Date.UTC(2026, 9, 18, 22),
      Date.UTC(2026, 9, 28, 10),
      'Europe/Madrid'
    )

    expect(weeks.map(week => week.length)).toEqual([7, 3])
    expect(weeks[0]?.[0]?.date).toBe('2026-10-19')
    expect(weeks[0]?.[6]).toEqual({ date: '2026-10-25', count: 7 })
    expect(weeks[1]?.map(day => day.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28'])
    expect(weeks[1]?.[2]?.count).toBe(3)
  })

  it('grades heatmap cells in five even steps of the busiest', () => {
    expect(inkLevel(0, 10)).toBe(0)
    expect(inkLevel(1, 10)).toBe(1)
    expect(inkLevel(5, 10)).toBe(3)
    expect(inkLevel(10, 10)).toBe(5)
  })

  it('counts sessions done by their last run end, leaving out ones that need you', () => {
    const doneLive = liveOf([
      sessionRecord('ses_done', {
        created: baseTime,
        idle: baseTime + 10,
        outcome: 'succeeded',
        handled: baseTime + 10
      }),
      sessionRecord('ses_waiting', {
        created: baseTime,
        idle: baseTime + hour + 10,
        outcome: 'succeeded'
      }),
      // Marked done for an earlier run: its latest run needs you again.
      sessionRecord('ses_again', {
        created: baseTime,
        idle: baseTime + hour + 20,
        outcome: 'failed',
        handled: baseTime + 5
      }),
      sessionRecord('ses_never_ran', { created: baseTime + 30 })
    ])

    const chart = doneOverTime(doneLive, report, undefined)

    expect(chart.series).toEqual([{ key: 'prj_vltra', name: 'vltra' }])
    expect(chart.rows.map(row => row.values)).toEqual([[1], [0]])

    // In the Prompts chart's project order, the others as the rest.
    expect(
      doneOverTime(doneLive, report, undefined, [otherProjectID]).series.map(series => series.key)
    ).toEqual([otherProjectID, restKey])
  })

  it('counts sessions done by day and in a range, for the year calendar and the Done tile', () => {
    const doneLive = liveOf([
      sessionRecord('ses_monday', {
        idle: Date.UTC(2026, 9, 5, 21, 30),
        outcome: 'succeeded',
        handled: Date.UTC(2026, 9, 5, 21, 30)
      }),
      // 23:30 UTC is already Tuesday in Madrid.
      sessionRecord('ses_late', {
        idle: Date.UTC(2026, 9, 5, 22, 30),
        outcome: 'succeeded',
        handled: Date.UTC(2026, 9, 5, 22, 30)
      }),
      sessionRecord('ses_waiting', { idle: Date.UTC(2026, 9, 5, 12), outcome: 'succeeded' })
    ])

    expect(doneByDay(doneLive, undefined, 'Europe/Madrid')).toEqual(
      new Map([
        ['2026-10-05', 1],
        ['2026-10-06', 1]
      ])
    )

    expect(
      doneCount(doneLive, { from: Date.UTC(2026, 9, 5), to: Date.UTC(2026, 9, 5, 22) }, undefined)
    ).toBe(1)

    // 53 weeks from a Monday, up to today (Tue Oct 6 2026): the last week has two days.
    const weeks = yearWeeks(new Map([['2026-10-06', 4]]), Date.UTC(2026, 9, 6, 10), 'Europe/Madrid')

    expect(weeks).toHaveLength(53)
    expect(weeks[0]?.[0]?.date).toBe('2025-10-06')
    expect(weeks.at(-1)).toEqual([
      { date: '2026-10-05', count: 0 },
      { date: '2026-10-06', count: 4 }
    ])
  })
})

describe('merged pull requests', () => {
  const minute = 60 * 1000

  /** Opened `open` ms before its merge. */
  const merged = (repo: string, mergedAt: number, open = 10 * minute): MergedPullRequest => ({
    repo,
    number: mergedAt,
    createdAt: mergedAt - open,
    mergedAt
  })

  it('stacks merges per bar by repo, by short name, the rest summed', () => {
    const chart = mergedByRepo(reportOf([bucket(0), bucket(1)]), [
      merged('magoz/vltra', baseTime + 5),
      merged('magoz/vltra', baseTime + hour + 5),
      merged('shhhlabs/10x', baseTime + 6),
      merged('magoz/o-o', baseTime + 7),
      merged('magoz/eat', baseTime + hour + 6),
      merged('magoz/eat', baseTime + hour + 7),
      // Outside every bar.
      merged('magoz/vltra', baseTime + 2 * hour)
    ])

    expect(chart.series).toEqual([
      { key: 'magoz/eat', name: 'eat' },
      { key: 'magoz/vltra', name: 'vltra' },
      { key: 'magoz/o-o', name: 'o-o' },
      { key: restKey, name: 'rest' }
    ])
    expect(chart.rows.map(row => row.values)).toEqual([
      [0, 1, 1, 1],
      [2, 1, 0, 0]
    ])
  })

  it('bins and takes the median of opened → merged, and counts repos', () => {
    const pulls = [
      merged('a/x', baseTime, 5 * minute),
      merged('a/x', baseTime, 40 * minute),
      merged('a/y', baseTime, 3 * hour),
      merged('a/z', baseTime, 4 * 24 * hour)
    ]

    expect(mergeTimes(pulls).map(bin => bin.count)).toEqual([1, 1, 1, 0, 0, 1])
    expect(mergeTimes(pulls)[0]?.label).toBe('<30m')
    expect(medianMergeTime(pulls)).toBe((40 * minute + 3 * hour) / 2)
    expect(medianMergeTime(pulls.slice(0, 3))).toBe(40 * minute)
    expect(medianMergeTime([])).toBeUndefined()
    expect(repoCount(pulls)).toBe(3)
  })

  it('counts merges per day in the zone', () => {
    // 22:30 UTC on Oct 5 is already Oct 6 in Madrid.
    const pulls = [
      merged('a/x', Date.UTC(2026, 9, 5, 22, 30)),
      merged('a/x', Date.UTC(2026, 9, 5, 12))
    ]

    expect(mergedByDay(pulls, 'Europe/Madrid')).toEqual(
      new Map([
        ['2026-10-06', 1],
        ['2026-10-05', 1]
      ])
    )
  })
})
