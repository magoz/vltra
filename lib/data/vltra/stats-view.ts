import { otherProjectID, projectKey, projectName } from '@/lib/data/vltra/board'
import type { LiveVltra } from '@/lib/data/vltra/board'
import type {
  VltraRow,
  HourActivity,
  MergedPullRequest,
  ModelUsage,
  Outcome,
  StatsBucket,
  PromptsByProject,
  StatsReport,
  TokenCounts
} from '@/lib/data/vltra/types'

// The Stats tab's charts, from a `StatsReport` (OpenCode's numbers), the live vltra (Vltra's own
// session list: sessions started, how runs ended) and GitHub's merged pull requests. Pure, so it
// runs (and is tested) anywhere.

/** OpenCode's project for sessions outside any repository (Vltra's "Other"). */
export const globalProjectID = 'global'

/** The OpenCode project a `?project=` filter (a `projectKey`) asks OpenCode's stats for. */
export const statsProjectID = (live: LiveVltra, key: string | undefined): string | undefined => {
  if (key !== otherProjectID) return key

  const other = Array.from(live.projects).find(([, project]) => project.directory === '/')

  return other?.[0] ?? globalProjectID
}

/**
 * Tokens the model read or wrote anew: everything but cache reads, which re-read the whole context
 * every step and dwarf the rest.
 */
export const freshTokens = (tokens: TokenCounts): number =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cacheWrite

export type ChartSeries = { readonly key: string; readonly name: string }

export type ChartRow = {
  readonly start: number
  readonly end: number
  /** One value per series, in the series' order. */
  readonly values: ReadonlyArray<number>
}

/** Bars over time, one stacked segment per series. */
export type SeriesChart = {
  readonly series: ReadonlyArray<ChartSeries>
  readonly rows: ReadonlyArray<ChartRow>
}

/**
 * Series with their own ink in a stacked chart (projects, models); the rest is one. Three: more
 * grey shades than that are hard to tell apart.
 */
export const stackLimit = 3

/** Projects with their own series in the project charts. */
export const projectSeriesLimit = stackLimit

/** The key of everything past the top series. */
export const restKey = '…rest'

/**
 * The `limit` keys with the largest totals, largest first, then `restKey` when any are left (a
 * stack with too many segments reads as noise).
 */
const topKeys = (totals: ReadonlyMap<string, number>, limit: number): ReadonlyArray<string> => {
  const ranked = Array.from(totals)
    .filter(([, total]) => total > 0)
    .toSorted(
      ([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey)
    )
    .map(([key]) => key)

  return ranked.length > limit ? [...ranked.slice(0, limit), restKey] : ranked
}

const seriesChart = (
  buckets: ReadonlyArray<Pick<StatsBucket, 'start' | 'end'>>,
  perBucket: ReadonlyArray<ReadonlyMap<string, number>>,
  limit: number,
  name: (key: string) => string
): SeriesChart => {
  const totals = new Map<string, number>()

  for (const values of perBucket) {
    for (const [key, value] of values) totals.set(key, (totals.get(key) ?? 0) + value)
  }

  const keys = topKeys(totals, limit)
  const top = new Set(keys)

  return {
    series: keys.map(key => ({ key, name: key === restKey ? 'rest' : name(key) })),
    rows: buckets.map((bucket, index) => {
      const values = perBucket[index] ?? new Map<string, number>()
      let rest = 0

      for (const [key, value] of values) if (!top.has(key)) rest += value

      return {
        start: bucket.start,
        end: bucket.end,
        values: keys.map(key => (key === restKey ? rest : (values.get(key) ?? 0)))
      }
    })
  }
}

/** The range's models, most fresh tokens first (OpenCode ranks them with cache reads). */
export const modelsByTokens = (report: StatsReport): ReadonlyArray<ModelUsage> =>
  report.totals.models.toSorted(
    (left, right) => freshTokens(right.tokens) - freshTokens(left.tokens)
  )

/** One series of bars from a bucket field. */
export const singleSeries = (
  report: StatsReport,
  name: string,
  value: (bucket: StatsBucket) => number
): SeriesChart => ({
  series: [{ key: name, name }],
  rows: report.buckets.map(bucket => ({
    start: bucket.start,
    end: bucket.end,
    values: [value(bucket)]
  }))
})

/** Fresh tokens per bucket by model (`provider/model#variant`), the top three and the rest. */
export const tokensByModel = (report: StatsReport, limit = stackLimit): SeriesChart =>
  seriesChart(
    report.buckets,
    report.buckets.map(
      bucket => new Map(bucket.models.map(entry => [entry.model, freshTokens(entry.tokens)]))
    ),
    limit,
    key => key
  )

/** Tool calls per bucket: ended well, failed, still running (or never ended). */
export const toolCalls = (report: StatsReport): SeriesChart => ({
  series: [
    { key: 'succeeded', name: 'succeeded' },
    { key: 'failed', name: 'failed' },
    { key: 'unfinished', name: 'unfinished' }
  ],
  rows: report.buckets.map(bucket => ({
    start: bucket.start,
    end: bucket.end,
    values: [bucket.tools.succeeded, bucket.tools.failed, bucket.tools.unfinished]
  }))
})

/** The bucket `[start, end)` holding `at`, by index; -1 outside every bucket. */
const bucketIndex = (buckets: ReadonlyArray<Pick<StatsBucket, 'start' | 'end'>>, at: number) =>
  buckets.findIndex(bucket => at >= bucket.start && at < bucket.end)

/** The root rows a filter (a `projectKey`, or all) keeps. */
const filteredRows = (live: LiveVltra, filter: string | undefined) =>
  Array.from(live.rows.values()).filter(
    row => filter === undefined || projectKey(live, row) === filter
  )

/**
 * Root rows counted per bucket of `at` (none: left out) by project: `order`'s projects when
 * given, else the top three, then the rest.
 */
const rowsByProject = (
  live: LiveVltra,
  report: StatsReport,
  filter: string | undefined,
  at: (row: VltraRow) => number | undefined,
  order: ReadonlyArray<string> | undefined
): SeriesChart => {
  const perBucket = report.buckets.map(() => new Map<string, number>())

  for (const row of filteredRows(live, filter)) {
    const time = at(row)
    const counts = time === undefined ? undefined : perBucket[bucketIndex(report.buckets, time)]

    if (counts === undefined) continue

    const key = projectKey(live, row)

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return order === undefined
    ? seriesChart(report.buckets, perBucket, projectSeriesLimit, key => projectName(live, key))
    : fixedSeriesChart(report.buckets, perBucket, order, key => projectName(live, key))
}

/**
 * Like `seriesChart` with the series given: `keys` in order (also when one has nothing), then the
 * rest when anything is left.
 */
const fixedSeriesChart = (
  buckets: ReadonlyArray<Pick<StatsBucket, 'start' | 'end'>>,
  perBucket: ReadonlyArray<ReadonlyMap<string, number>>,
  keys: ReadonlyArray<string>,
  name: (key: string) => string
): SeriesChart => {
  const top = new Set(keys)

  const rows = buckets.map((bucket, index) => {
    const values = perBucket[index] ?? new Map<string, number>()
    let rest = 0

    for (const [key, value] of values) if (!top.has(key)) rest += value

    return { bucket, values: keys.map(key => values.get(key) ?? 0), rest }
  })

  const anyRest = rows.some(row => row.rest > 0)

  return {
    series: [
      ...keys.map(key => ({ key, name: name(key) })),
      ...(anyRest ? [{ key: restKey, name: 'rest' }] : [])
    ],
    rows: rows.map(row => ({
      start: row.bucket.start,
      end: row.bucket.end,
      values: anyRest ? [...row.values, row.rest] : row.values
    }))
  }
}

/** The Prompts chart's projects (`projectKey`s), most prompts first. */
export const promptProjectKeys = (live: LiveVltra, data: PromptsByProject): ReadonlyArray<string> =>
  Array.from(new Set(data.projects.map(project => projectKey(live, project))))

/**
 * Prompts per bar by project: the top three (as `projectKey`s, Other for sessions outside a
 * repository), then the rest (all projects' prompts less theirs).
 */
export const promptsByProjectChart = (live: LiveVltra, data: PromptsByProject): SeriesChart => {
  const perBucket = data.buckets.map((bucket, index) => {
    const counts = new Map<string, number>()
    let listed = 0

    for (const project of data.projects) {
      const prompts = project.prompts[index] ?? 0
      const key = projectKey(live, project)

      counts.set(key, (counts.get(key) ?? 0) + prompts)
      listed += prompts
    }

    counts.set(restKey, Math.max(0, bucket.prompts - listed))

    return counts
  })

  return fixedSeriesChart(data.buckets, perBucket, promptProjectKeys(live, data), key =>
    projectName(live, key)
  )
}

export type OutcomeCounts = { readonly [Key in Outcome]: number }

/** How root sessions' latest runs that ended in the range ended (earlier runs are not kept). */
export const runOutcomes = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
): OutcomeCounts => {
  const counts = { succeeded: 0, failed: 0, interrupted: 0 }

  for (const row of filteredRows(live, filter)) {
    if (row.idle === undefined || row.outcome === undefined) continue

    if (row.idle >= report.from && row.idle < report.to) counts[row.outcome] += 1
  }

  return counts
}

/** Root sessions started in the range. */
export const sessionsStarted = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
): number =>
  filteredRows(live, filter).filter(row => row.created >= report.from && row.created < report.to)
    .length

/** The heatmap's rows, Monday first. */
export const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Something that happened `count` times at `at` (an hour's prompts, a session start). */
export type TimePoint = { readonly at: number; readonly count: number }

/** Counts by weekday and hour of the day in the report's zone, and by hour alone. */
export type HourGrid = {
  /** 7 rows (Monday first) of 24 hours. */
  readonly cells: ReadonlyArray<ReadonlyArray<number>>
  readonly byHour: ReadonlyArray<number>
  readonly total: number
}

/** The weekday (Monday = 0) and hour (0–23) of an instant in `timeZone`. */
const clockIn = (timeZone: string) => {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23'
  })

  return (at: number) => {
    const parts = new Map(format.formatToParts(at).map(part => [part.type, part.value]))
    const weekday = weekdays.findIndex(day => day === parts.get('weekday'))

    return { weekday: Math.max(0, weekday), hour: Number(parts.get('hour') ?? 0) % 24 }
  }
}

/** Points counted into the weekday × hour grid of `timeZone`. */
export const hourGrid = (points: ReadonlyArray<TimePoint>, timeZone: string): HourGrid => {
  const clock = clockIn(timeZone)
  const cells = weekdays.map(() => Array.from({ length: 24 }, () => 0))
  const byHour = Array.from({ length: 24 }, () => 0)
  let total = 0

  for (const point of points) {
    if (point.count === 0) continue

    const { weekday, hour } = clock(point.at)
    const row = cells[weekday]

    if (row !== undefined) row[hour] = (row[hour] ?? 0) + point.count

    byHour[hour] = (byHour[hour] ?? 0) + point.count
    total += point.count
  }

  return { cells, byHour, total }
}

/** Each hour's prompts, at the hour's start. */
export const promptPoints = (hours: ReadonlyArray<HourActivity>): ReadonlyArray<TimePoint> =>
  hours.map(hour => ({ at: hour.start, count: hour.prompts }))

/** Root sessions started in the range (Vltra's list), each once. */
export const sessionStartPoints = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
): ReadonlyArray<TimePoint> =>
  filteredRows(live, filter)
    .filter(row => row.created >= report.from && row.created < report.to)
    .map(row => ({ at: row.created, count: 1 }))

/** A tile's per-bucket values, for its sparkline. */
export const tileSeries = (report: StatsReport) => ({
  prompts: report.buckets.map(bucket => bucket.prompts),
  steps: report.buckets.map(bucket => bucket.steps),
  tokens: report.buckets.map(bucket => freshTokens(bucket.tokens)),
  cacheReads: report.buckets.map(bucket => bucket.tokens.cacheRead),
  toolCalls: report.buckets.map(bucket => bucket.tools.calls)
})

/** The change from `previous` to `current` in percent; none without a previous value. */
export const changePercent = (current: number, previous: number | undefined) =>
  previous === undefined || previous === 0 ? undefined : ((current - previous) / previous) * 100

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)

/** Steps per prompt in each bucket: how much the agents do per message. */
export const stepsPerPrompt = (report: StatsReport): SeriesChart =>
  singleSeries(report, 'steps per prompt', bucket => ratio(bucket.steps, bucket.prompts))

/** Cache reads as a % of all input (fresh input, cache reads and writes) per bucket. */
export const cacheHitRatio = (report: StatsReport): SeriesChart =>
  singleSeries(
    report,
    'cache hits',
    bucket =>
      100 *
      ratio(
        bucket.tokens.cacheRead,
        bucket.tokens.cacheRead + bucket.tokens.input + bucket.tokens.cacheWrite
      )
  )

/** Failed tool calls as a % of all per bucket. */
export const toolFailureRate = (report: StatsReport): SeriesChart =>
  singleSeries(report, 'failed', bucket => 100 * ratio(bucket.tools.failed, bucket.tools.calls))

/**
 * Root sessions done (marked done, or counting as done, their folder gone) by project, by when
 * their latest run ended (the time of its last message): Vltra does not record when Done was
 * pressed, and keeps only the latest run's marker. `order`'s projects when given (the Prompts
 * chart's, so a project has one colour on both), else the top three, then the rest.
 */
export const doneOverTime = (
  live: LiveVltra,
  report: StatsReport,
  filter: string | undefined,
  order?: ReadonlyArray<string>
): SeriesChart =>
  rowsByProject(
    live,
    report,
    filter,
    row => (row.state === 'handled' ? row.idle : undefined),
    order
  )

/** How root sessions' latest runs ended, per bucket of the end (earlier runs are not kept). */
export const outcomesOverTime = (
  live: LiveVltra,
  report: StatsReport,
  filter: string | undefined
): SeriesChart => {
  const outcomes = ['succeeded', 'failed', 'interrupted'] as const
  const perBucket = report.buckets.map(() => ({ succeeded: 0, failed: 0, interrupted: 0 }))

  for (const row of filteredRows(live, filter)) {
    if (row.idle === undefined || row.outcome === undefined) continue

    const counts = perBucket[bucketIndex(report.buckets, row.idle)]

    if (counts !== undefined) counts[row.outcome] += 1
  }

  return {
    series: outcomes.map(outcome => ({ key: outcome, name: outcome })),
    rows: report.buckets.map((bucket, index) => ({
      start: bucket.start,
      end: bucket.end,
      values: outcomes.map(outcome => perBucket[index]?.[outcome] ?? 0)
    }))
  }
}

/** Each bucket's tokens by model as shares (each bar adds up to 100%). */
export const modelShare = (report: StatsReport): SeriesChart => {
  const chart = tokensByModel(report)

  return {
    series: chart.series,
    rows: chart.rows.map(row => {
      const total = row.values.reduce((sum, value) => sum + value, 0)

      return { ...row, values: row.values.map(value => 100 * ratio(value, total)) }
    })
  }
}

/** One bar of a distribution: a labelled range and how many fall in it. */
export type CategoryCount = { readonly label: string; readonly count: number }

const minute = 60 * 1000

const hourMs = 60 * minute

/** Session lengths' bins: under a minute up to over a day. */
const lengthBins: ReadonlyArray<{ readonly label: string; readonly below: number }> = [
  { label: '<1m', below: minute },
  { label: '1–5m', below: 5 * minute },
  { label: '5–15m', below: 15 * minute },
  { label: '15–30m', below: 30 * minute },
  { label: '30m–1h', below: hourMs },
  { label: '1–2h', below: 2 * hourMs },
  { label: '2–6h', below: 6 * hourMs },
  { label: '6–24h', below: 24 * hourMs },
  { label: '>1d', below: Number.POSITIVE_INFINITY }
]

/** Root sessions started in the range that ran (Vltra's list). */
const startedRows = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
) => filteredRows(live, filter).filter(row => row.created >= report.from && row.created < report.to)

/**
 * How long sessions started in the range stayed open: creation to the end of their latest run
 * (open time, not work time); sessions that never ran are left out.
 */
export const sessionLengths = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
): ReadonlyArray<CategoryCount> => {
  const counts = lengthBins.map(() => 0)

  for (const row of startedRows(live, report, filter)) {
    if (row.idle === undefined) continue

    const length = row.idle - row.created
    const bin = lengthBins.findIndex(candidate => length < candidate.below)

    counts[bin] = (counts[bin] ?? 0) + 1
  }

  return lengthBins.map((bin, index) => ({ label: bin.label, count: counts[index] ?? 0 }))
}

const subagentBins: ReadonlyArray<{ readonly label: string; readonly upTo: number }> = [
  { label: '0', upTo: 0 },
  { label: '1', upTo: 1 },
  { label: '2', upTo: 2 },
  { label: '3–5', upTo: 5 },
  { label: '6–10', upTo: 10 },
  { label: '>10', upTo: Number.POSITIVE_INFINITY }
]

/** Sessions started in the range by how many subagents (all depths) they ran. */
export const subagentCounts = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
): ReadonlyArray<CategoryCount> => {
  const counts = subagentBins.map(() => 0)

  for (const row of startedRows(live, report, filter)) {
    const bin = subagentBins.findIndex(candidate => row.children.length <= candidate.upTo)

    counts[bin] = (counts[bin] ?? 0) + 1
  }

  return subagentBins.map((bin, index) => ({ label: bin.label, count: counts[index] ?? 0 }))
}

/** One session in the tokens × length scatter. */
export type SessionPoint = {
  readonly id: string
  readonly title: string
  readonly project: string
  /** Open time in ms (creation to the end of the latest run). */
  readonly length: number
  /** Its own and its subagents' fresh tokens. */
  readonly tokens: number
}

/** Sessions started in the range that ran, with their open time and tokens (subagents' too). */
export const sessionPoints = (
  live: LiveVltra,
  report: Pick<StatsReport, 'from' | 'to'>,
  filter: string | undefined
): ReadonlyArray<SessionPoint> =>
  startedRows(live, report, filter).flatMap(row =>
    row.idle === undefined
      ? []
      : [
          {
            id: row.id,
            title: row.title ?? row.id,
            project: projectName(live, projectKey(live, row)),
            length: Math.max(1000, row.idle - row.created),
            tokens: Math.max(
              1,
              row.tokens + row.children.reduce((sum, child) => sum + child.tokens, 0)
            )
          }
        ]
  )

/** One day of the year calendar and how many it counts. */
export type CalendarDay = { readonly date: string; readonly count: number }

/**
 * The calendar's columns: weeks from `from`'s day (a Monday), up to `to`'s day; days after it are
 * left out of the last week. `counts` by `YYYY-MM-DD` in `timeZone`; days without one count 0.
 */
export const calendarGrid = (
  counts: ReadonlyMap<string, number>,
  from: number,
  to: number,
  timeZone: string
): ReadonlyArray<ReadonlyArray<CalendarDay>> => {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone })
  const last = format.format(to)
  const columns: Array<Array<CalendarDay>> = []
  // Noon of each day steps safely across DST changes.
  let at = from + 12 * hourMs
  let date = format.format(at)

  while (date <= last) {
    const day = { date, count: counts.get(date) ?? 0 }
    const week = columns.at(-1)

    if (week === undefined || week.length === 7) columns.push([day])
    else week.push(day)

    at += 24 * hourMs
    // A DST day is 23 or 25 hours: noon keeps the next day's date right.
    const next = format.format(at)

    date = next === date ? format.format((at += hourMs)) : next
  }

  return columns
}

/** An ink level 1–5 for a heatmap cell (0 for none): even steps of the busiest value. */
export const inkLevel = (value: number, largest: number): number =>
  value <= 0 || largest <= 0 ? 0 : Math.min(5, Math.ceil((5 * value) / largest))

/**
 * The year calendar's weeks up to `now` in `timeZone`: 53 of them, from the Monday 52 weeks before
 * this one, with `counts` by day.
 */
export const yearWeeks = (
  counts: ReadonlyMap<string, number>,
  now: number,
  timeZone: string
): ReadonlyArray<ReadonlyArray<CalendarDay>> => {
  const { weekday } = clockIn(timeZone)(now)
  // `calendarGrid` steps from noon: this time of day, `weekday + 52 weeks` days back, is a Monday.
  const monday = now - (weekday + 52 * 7) * 24 * hourMs - 12 * hourMs

  return calendarGrid(counts, monday, now, timeZone)
}

/**
 * Root sessions done per day (`YYYY-MM-DD` in `timeZone`) of their latest run's end, as the Done
 * chart counts them: marked done, or counting as done, their folder gone.
 */
export const doneByDay = (
  live: LiveVltra,
  filter: string | undefined,
  timeZone: string
): ReadonlyMap<string, number> => {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone })
  const counts = new Map<string, number>()

  for (const row of filteredRows(live, filter)) {
    if (row.state !== 'handled' || row.idle === undefined) continue

    const day = format.format(row.idle)

    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  return counts
}

/** Root sessions done whose latest run ended in `[from, to)`. */
export const doneCount = (
  live: LiveVltra,
  range: { readonly from: number; readonly to: number },
  filter: string | undefined
): number =>
  filteredRows(live, filter).filter(
    row =>
      row.state === 'handled' &&
      row.idle !== undefined &&
      row.idle >= range.from &&
      row.idle < range.to
  ).length

/** A repository's short name: `owner/name` → `name`. */
const repoName = (repo: string) => repo.slice(repo.indexOf('/') + 1)

/** Merged pull requests per bucket of their merge by repository: the top three, then the rest. */
export const mergedByRepo = (
  report: StatsReport,
  pulls: ReadonlyArray<MergedPullRequest>
): SeriesChart => {
  const perBucket = report.buckets.map(() => new Map<string, number>())

  for (const pull of pulls) {
    const counts = perBucket[bucketIndex(report.buckets, pull.mergedAt)]

    if (counts !== undefined) counts.set(pull.repo, (counts.get(pull.repo) ?? 0) + 1)
  }

  return seriesChart(report.buckets, perBucket, stackLimit, repoName)
}

/** Repositories with a merge among `pulls`. */
export const repoCount = (pulls: ReadonlyArray<MergedPullRequest>): number =>
  new Set(pulls.map(pull => pull.repo)).size

/** Time to merge's bins: within half an hour up to over three days. */
const mergeBins: ReadonlyArray<{ readonly label: string; readonly below: number }> = [
  { label: '<30m', below: 30 * minute },
  { label: '30m–2h', below: 2 * hourMs },
  { label: '2–8h', below: 8 * hourMs },
  { label: '8–24h', below: 24 * hourMs },
  { label: '1–3d', below: 72 * hourMs },
  { label: '>3d', below: Number.POSITIVE_INFINITY }
]

/** How long merged pull requests stayed open: opened to merged. */
export const mergeTimes = (
  pulls: ReadonlyArray<MergedPullRequest>
): ReadonlyArray<CategoryCount> => {
  const counts = mergeBins.map(() => 0)

  for (const pull of pulls) {
    const bin = mergeBins.findIndex(candidate => pull.mergedAt - pull.createdAt < candidate.below)

    counts[bin] = (counts[bin] ?? 0) + 1
  }

  return mergeBins.map((bin, index) => ({ label: bin.label, count: counts[index] ?? 0 }))
}

/** The median time from opened to merged; none without pulls. */
export const medianMergeTime = (pulls: ReadonlyArray<MergedPullRequest>): number | undefined => {
  const times = pulls.map(pull => pull.mergedAt - pull.createdAt).toSorted((a, b) => a - b)
  const middle = Math.floor(times.length / 2)
  const upper = times[middle]

  if (upper === undefined) return undefined

  return times.length % 2 === 1 ? upper : ((times[middle - 1] ?? upper) + upper) / 2
}

/** Merged pull requests per day (`YYYY-MM-DD` in `timeZone`) of their merge. */
export const mergedByDay = (
  pulls: ReadonlyArray<MergedPullRequest>,
  timeZone: string
): ReadonlyMap<string, number> => {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone })
  const counts = new Map<string, number>()

  for (const pull of pulls) {
    const day = format.format(pull.mergedAt)

    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  return counts
}
