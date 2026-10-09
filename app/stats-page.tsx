'use client'

import { Option, Schema } from 'effect'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFleet } from '@/app/fleet-context'
import { ProjectFilter } from '@/app/project-filter'
import type { ProjectFilterHandle } from '@/app/project-filter'
import { SessionSplit } from '@/app/session-panel'
import { cardGrid, StatsCard, Tile, wide } from '@/app/stats-card'
import type { TrendLine } from '@/app/stats-card'
import { CategoryBars, HourBars, SessionScatter, ShareTable, TimeBars } from '@/app/stats-charts'
import { CalendarHeatmap, HourHeatmap } from '@/app/stats-heatmaps'
import { BarsPlaceholder, HeatmapPlaceholder, StatsSkeleton } from '@/app/stats-skeleton'
import {
  bucketTitle,
  calendarDay,
  compactNumber,
  durationText,
  percentText,
  percentValue,
  rangeText,
  wholeNumber
} from '@/app/stats-format'
import { useKeys } from '@/app/use-keys'
import {
  browserTimeZone,
  shownValue,
  statsHoursUrl,
  statsProjectsUrl,
  statsUrl,
  useStats,
  useStatsHours,
  useStatsProjects
} from '@/app/use-stats'
import type { StatsState } from '@/app/use-stats'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { calendarDayParts, StatsPeriod, statsPresets } from '@/lib/data/fleet/stats-period'
import type { StatsPreset } from '@/lib/data/fleet/stats-period'
import {
  cacheHitRatio,
  changePercent,
  doneByDay,
  doneCount,
  doneOverTime,
  freshTokens,
  hourGrid,
  modelShare,
  modelsByTokens,
  outcomesOverTime,
  promptPoints,
  promptProjectKeys,
  promptsByProjectChart,
  runOutcomes,
  sessionLengths,
  sessionPoints,
  sessionsByProject,
  sessionStartPoints,
  sessionsStarted,
  singleSeries,
  statsProjectID,
  stepsPerPrompt,
  subagentCounts,
  tileSeries,
  yearWeeks,
  tokensByModel,
  toolCalls,
  toolFailureRate
} from '@/lib/data/fleet/stats-view'
import type { HourGrid, SeriesChart } from '@/lib/data/fleet/stats-view'
import { HoursRead } from '@/lib/data/fleet/types'
import type { PromptsByProject, StatsHours, StatsReport } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

const presetLabels: Readonly<Record<StatsPreset, string>> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'All'
}

const day = 24 * 60 * 60 * 1000

/** The preset `delta` steps from the period's (`[` / `]`); days count as the default's. */
const steppedPreset = (period: StatsPeriod, delta: 1 | -1): StatsPreset => {
  const current = StatsPeriod.$is('Preset')(period) ? period.preset : '7d'
  const index = statsPresets.indexOf(current) + delta

  return statsPresets[Math.max(0, Math.min(index, statsPresets.length - 1))] ?? current
}

const segment =
  'focus-visible:ring-ring/50 h-7 px-2 text-xs outline-none focus-visible:ring-[3px] aria-pressed:bg-foreground aria-pressed:text-background hover:bg-accent aria-pressed:hover:bg-foreground'

/**
 * The range: presets (`24h` … `All`) as a segmented control, and Custom, two day fields that
 * apply once both hold days in order. Every change replaces the URL (`nav.setPeriod`).
 */
function RangePicker({ timeZone }: { readonly timeZone: string }) {
  const { nav, now } = useFleet()
  const { period } = nav
  const today = calendarDay(now, timeZone)
  const days = StatsPeriod.$is('Days')(period) ? period : undefined
  const [custom, setCustom] = useState(days !== undefined)

  const [draft, setDraft] = useState(() => ({
    from: days?.from ?? calendarDay(now - 6 * day, timeZone),
    to: days?.to ?? today
  }))

  const change = (next: { readonly from: string; readonly to: string }) => {
    setDraft(next)

    const valid = [next.from, next.to].every(value => Option.isSome(calendarDayParts(value)))

    if (valid && next.from <= next.to) nav.setPeriod(StatsPeriod.Days(next))
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label="Range" className="flex border">
        {statsPresets.map(preset => (
          <button
            key={preset}
            type="button"
            aria-pressed={!custom && StatsPeriod.$is('Preset')(period) && period.preset === preset}
            onClick={() => {
              setCustom(false)
              nav.setPeriod(StatsPeriod.Preset({ preset }))
            }}
            className={segment}
          >
            {presetLabels[preset]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom || days !== undefined}
          onClick={() => {
            setCustom(true)
            change(draft)
          }}
          className={cn(segment, 'border-l')}
        >
          Custom
        </button>
      </div>
      {custom || days !== undefined ? (
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <input
            type="date"
            aria-label="From"
            value={draft.from}
            max={today}
            onChange={event => change({ ...draft, from: event.target.value })}
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-7 border px-1.5 font-mono text-xs outline-none focus-visible:ring-[3px]"
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To"
            value={draft.to}
            max={today}
            onChange={event => change({ ...draft, to: event.target.value })}
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-7 border px-1.5 font-mono text-xs outline-none focus-visible:ring-[3px]"
          />
        </div>
      ) : null}
    </div>
  )
}

/** `Sep 30 – Oct 6 · by day`, then `loading…` or the error. */
function StatusLine({
  state,
  report
}: {
  readonly state: StatsState<StatsReport>
  readonly report: StatsReport | undefined
}) {
  return (
    <p role="status" aria-label="Range shown" className="text-muted-foreground text-xs">
      {report === undefined
        ? null
        : `${rangeText(report.from, report.to, report.timezone)} · by ${report.unit}`}
      {state.status === 'loading' ? (
        <span>{report === undefined ? 'loading…' : ' · loading…'}</span>
      ) : null}
      {state.status === 'failed' ? (
        <span className="text-destructive">
          {report === undefined ? state.error : ` · ${state.error}`}
        </span>
      ) : null}
    </p>
  )
}

function Tiles({
  report,
  started,
  done
}: {
  readonly report: StatsReport
  readonly started: number
  /** The Done chart: its bars feed the Done tile's sparkline. */
  readonly done: SeriesChart
}) {
  const { view, nav } = useFleet()
  const { totals, previous } = report
  const doneNow = doneCount(view, report, nav.project)
  const doneBefore = previous === undefined ? undefined : doneCount(view, previous, nav.project)
  const tokens = freshTokens(totals.tokens)
  const tools = totals.toolTotals
  const trend = tileSeries(report)

  const labels = report.buckets.map(bucket =>
    bucketTitle(bucket.start, report.unit, report.timezone)
  )

  const line = (values: ReadonlyArray<number>): TrendLine => ({ values, labels })

  return (
    <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-4 @5xl:grid-cols-7">
      <Tile
        label="Done"
        value={compactNumber(doneNow)}
        detail={`${compactNumber(totals.subagents)} subagents`}
        title={`${wholeNumber(doneNow)} sessions done (their latest run ended in the range); ${wholeNumber(totals.sessions)} sessions and ${wholeNumber(totals.subagents)} subagents with activity; ${wholeNumber(started)} sessions started`}
        change={changePercent(doneNow, doneBefore)}
        trend={line(done.rows.map(row => row.values.reduce((sum, value) => sum + value, 0)))}
      />
      <Tile
        label="Prompts"
        value={compactNumber(totals.prompts)}
        detail={`${compactNumber(started)} sessions started`}
        title={`${wholeNumber(totals.prompts)} prompts`}
        change={changePercent(totals.prompts, previous?.prompts)}
        trend={line(trend.prompts)}
      />
      <Tile
        label="Steps"
        value={compactNumber(totals.steps)}
        detail={
          totals.prompts === 0
            ? 'model calls'
            : `${compactNumber(totals.steps / totals.prompts)} per prompt`
        }
        title={`${wholeNumber(totals.steps)} steps (model calls)`}
        change={changePercent(totals.steps, previous?.steps)}
        trend={line(trend.steps)}
      />
      <Tile
        label="Tool calls"
        value={compactNumber(tools.calls)}
        detail={
          <span className={cn(tools.failed > 0 && 'text-destructive')}>
            {percentText(tools.failed, tools.calls)} failed
          </span>
        }
        title={`${wholeNumber(tools.succeeded)} succeeded, ${wholeNumber(tools.failed)} failed, ${wholeNumber(tools.unfinished)} unfinished`}
        change={changePercent(tools.calls, previous?.toolTotals.calls)}
        trend={line(trend.toolCalls)}
      />
      <Tile
        label="Tokens"
        value={compactNumber(tokens)}
        detail={`${compactNumber(totals.tokens.output)} out`}
        title={[
          `input ${wholeNumber(totals.tokens.input)}`,
          `output ${wholeNumber(totals.tokens.output)}`,
          `reasoning ${wholeNumber(totals.tokens.reasoning)}`,
          `cache writes ${wholeNumber(totals.tokens.cacheWrite)}`,
          `cache reads ${wholeNumber(totals.tokens.cacheRead)} (not counted)`
        ].join('\n')}
        change={changePercent(
          tokens,
          previous === undefined ? undefined : freshTokens(previous.tokens)
        )}
        trend={line(trend.tokens)}
      />
      <Tile
        label="Cache reads"
        value={compactNumber(totals.tokens.cacheRead)}
        detail={`${percentText(totals.tokens.cacheRead, totals.tokens.cacheRead + totals.tokens.input)} of input`}
        title={`${wholeNumber(totals.tokens.cacheRead)} tokens read from cache`}
        change={changePercent(totals.tokens.cacheRead, previous?.tokens.cacheRead)}
        trend={line(trend.cacheReads)}
      />
      <Tile
        label="Active days"
        value={String(totals.activeDays)}
        detail={`${totals.streak}d streak`}
        title="Days with any step; the streak is the longest run of them"
      />
    </dl>
  )
}

/** How root sessions' latest runs in the range ended, as share bars. */
function Outcomes({
  view,
  report,
  filter
}: {
  readonly view: LiveFleet
  readonly report: StatsReport
  readonly filter: string | undefined
}) {
  const counts = runOutcomes(view, report, filter)
  const total = counts.succeeded + counts.failed + counts.interrupted

  return (
    <ShareTable
      label="Outcome"
      columns={['runs', 'share']}
      empty="No runs ended in this range."
      rows={(['succeeded', 'failed', 'interrupted'] as const).map(outcome => ({
        key: outcome,
        label: outcome,
        value: counts[outcome],
        alarm: outcome === 'failed',
        cells: [wholeNumber(counts[outcome]), percentText(counts[outcome], total)]
      }))}
    />
  )
}

const isHoursRead = Schema.is(HoursRead)

/**
 * When in the day and week: prompts per hour (their own read, up to 31 days), else sessions
 * started from Fleet's list (free for any range), as a weekday × hour heatmap and 24 hour bars.
 */
function TimeOfDay({
  report,
  hours,
  filter
}: {
  readonly report: StatsReport
  readonly hours: StatsState<StatsHours>
  readonly filter: string | undefined
}) {
  const { view } = useFleet()
  const shown = shownValue(hours)

  const source = useMemo(() => {
    if (shown === undefined) return undefined

    return isHoursRead(shown)
      ? {
          noun: 'prompts',
          detail: 'prompts by weekday and hour',
          grid: hourGrid(promptPoints(shown.hours), shown.timezone)
        }
      : {
          noun: 'sessions started',
          detail: 'sessions started (prompts only up to 31 days)',
          grid: hourGrid(sessionStartPoints(view, report, filter), report.timezone)
        }
  }, [shown, view, report, filter])

  const body = (chart: (grid: HourGrid, noun: string) => ReactNode, placeholder: ReactNode) => {
    if (source !== undefined) {
      return (
        <div className={cn('transition-opacity', hours.status === 'loading' && 'opacity-50')}>
          {chart(source.grid, source.noun)}
        </div>
      )
    }

    return hours.status === 'failed' ? (
      <p className="text-destructive text-xs">{hours.error}</p>
    ) : (
      placeholder
    )
  }

  return (
    <>
      <StatsCard title="Time of day" detail={source?.detail ?? 'by weekday and hour'}>
        {body(
          (grid, noun) => (
            <HourHeatmap grid={grid} noun={noun} />
          ),
          <HeatmapPlaceholder />
        )}
      </StatsCard>
      <StatsCard title="By hour of day" detail={source?.noun ?? 'whole range'}>
        {body(
          (grid, noun) => (
            <HourBars grid={grid} noun={noun} />
          ),
          <BarsPlaceholder />
        )}
      </StatsCard>
    </>
  )
}

/**
 * Sessions done per day over the last year, whatever the range (Fleet's list, like the Done
 * chart), recounted as the list changes.
 */
function YearCalendar({ timeZone }: { readonly timeZone: string }) {
  const { view, now, nav } = useFleet()

  const weeks = useMemo(
    () => yearWeeks(doneByDay(view, nav.project, timeZone), now, timeZone),
    [view, nav.project, now, timeZone]
  )

  return (
    <StatsCard title="Last year" detail="sessions done per day, whatever the range">
      <CalendarHeatmap weeks={weeks} noun="done" />
    </StatsCard>
  )
}

function StatsBody({
  report,
  hours,
  projects,
  filter
}: {
  readonly report: StatsReport
  readonly hours: StatsState<StatsHours>
  readonly projects: StatsState<PromptsByProject>
  readonly filter: string | undefined
}) {
  const { view } = useFleet()
  const { unit, timezone: timeZone, totals } = report

  // Prompts by project once that read answers for this range, and only unfiltered (filtered, the
  // report's own prompts are that one project's); until then the report's total.
  const byProject = filter === undefined && projects.status === 'ready' ? projects.value : undefined

  const charts = useMemo(
    () => ({
      steps: singleSeries(report, 'steps', bucket => bucket.steps),
      prompts:
        byProject === undefined
          ? { chart: singleSeries(report, 'prompts', bucket => bucket.prompts), unit, timeZone }
          : {
              chart: promptsByProjectChart(view, byProject),
              unit: byProject.unit,
              timeZone: byProject.timezone
            },
      tokens: tokensByModel(report),
      tools: toolCalls(report),
      projects: sessionsByProject(
        view,
        report,
        filter,
        byProject === undefined ? undefined : promptProjectKeys(view, byProject)
      ),
      stepsPerPrompt: stepsPerPrompt(report),
      modelShare: modelShare(report),
      cacheHits: cacheHitRatio(report),
      toolFailures: toolFailureRate(report),
      outcomes: outcomesOverTime(view, report, filter),
      done: doneOverTime(
        view,
        report,
        filter,
        byProject === undefined ? undefined : promptProjectKeys(view, byProject)
      ),
      lengths: sessionLengths(view, report, filter),
      subagents: subagentCounts(view, report, filter),
      points: sessionPoints(view, report, filter)
    }),
    [report, view, filter, byProject, unit, timeZone]
  )

  const started = sessionsStarted(view, report, filter)

  if (report.buckets.length === 0) {
    return <p className="text-muted-foreground py-10 text-center">No activity in this range.</p>
  }

  return (
    <>
      <Tiles report={report} started={started} done={charts.done} />
      <div className={cardGrid}>
        <StatsCard title="Done" detail="sessions marked done by project, by their last run's end">
          <TimeBars chart={charts.done} unit={unit} timeZone={timeZone} format={compactNumber} />
        </StatsCard>
        <StatsCard title="Sessions started" detail="by project, from Fleet's list">
          <TimeBars
            chart={charts.projects}
            unit={unit}
            timeZone={timeZone}
            format={compactNumber}
          />
        </StatsCard>
        <StatsCard title="Prompts" detail="your messages, by project">
          <TimeBars
            chart={charts.prompts.chart}
            unit={charts.prompts.unit}
            timeZone={charts.prompts.timeZone}
            format={compactNumber}
          />
        </StatsCard>
        <YearCalendar timeZone={timeZone} />
        <TimeOfDay report={report} hours={hours} filter={filter} />
        <StatsCard title="Steps" detail="model calls">
          <TimeBars chart={charts.steps} unit={unit} timeZone={timeZone} format={compactNumber} />
        </StatsCard>
        <StatsCard title="Steps per prompt" detail="how much the agents do per message">
          <TimeBars
            chart={charts.stepsPerPrompt}
            unit={unit}
            timeZone={timeZone}
            format={compactNumber}
          />
        </StatsCard>
        <StatsCard title="Tokens by model" detail="excl. cache reads">
          <TimeBars chart={charts.tokens} unit={unit} timeZone={timeZone} format={compactNumber} />
        </StatsCard>
        <StatsCard title="Model share" detail="% of each bar's tokens">
          <TimeBars
            chart={charts.modelShare}
            unit={unit}
            timeZone={timeZone}
            format={percentValue}
            max={100}
          />
        </StatsCard>
        <StatsCard title="Tool calls">
          <TimeBars
            chart={charts.tools}
            unit={unit}
            timeZone={timeZone}
            format={compactNumber}
            colors={{
              succeeded: 'var(--chart-2)',
              failed: 'var(--destructive)',
              unfinished: 'var(--chart-rest)'
            }}
          />
        </StatsCard>
        <StatsCard title="Tool failure rate" detail="% of tool calls that failed">
          <TimeBars
            chart={charts.toolFailures}
            unit={unit}
            timeZone={timeZone}
            format={percentValue}
            colors={{ failed: 'var(--destructive)' }}
          />
        </StatsCard>
        <StatsCard title="Cache hits" detail="cache reads, % of all input">
          <TimeBars
            chart={charts.cacheHits}
            unit={unit}
            timeZone={timeZone}
            format={percentValue}
            max={100}
          />
        </StatsCard>
        <StatsCard title="Run outcomes over time" detail="latest run of each session, by its end">
          <TimeBars
            chart={charts.outcomes}
            unit={unit}
            timeZone={timeZone}
            format={compactNumber}
            colors={{
              succeeded: 'var(--chart-2)',
              failed: 'var(--destructive)',
              interrupted: 'var(--chart-4)'
            }}
          />
        </StatsCard>
        <StatsCard title="Session length" detail="sessions started, creation to latest run end">
          <CategoryBars data={charts.lengths} noun="sessions" />
        </StatsCard>
        <StatsCard title="Subagents per session" detail="sessions started, by subagents run">
          <CategoryBars data={charts.subagents} noun="sessions" />
        </StatsCard>
        <StatsCard title="Tokens × length" detail="a dot per session started (log scales)">
          <SessionScatter points={charts.points} />
        </StatsCard>
        <StatsCard title="Models" detail="whole range">
          <ShareTable
            label="Model"
            columns={['steps', 'tokens']}
            empty="No model calls."
            rows={modelsByTokens(report).map(entry => ({
              key: entry.model,
              label: entry.model,
              value: freshTokens(entry.tokens),
              title: `${entry.model}: ${wholeNumber(freshTokens(entry.tokens))} tokens excl. cache reads, ${wholeNumber(entry.tokens.cacheRead)} cache reads`,
              cells: [compactNumber(entry.steps), compactNumber(freshTokens(entry.tokens))]
            }))}
          />
        </StatsCard>
        <StatsCard title="Tools" detail="whole range; median duration" className={wide}>
          <ShareTable
            label="Tool"
            columns={['calls', 'failed', 'p50']}
            empty="No tool calls."
            rows={totals.tools.map(tool => ({
              key: tool.name,
              label: tool.name,
              value: tool.calls,
              title: `${tool.name}: ${wholeNumber(tool.succeeded)} succeeded, ${wholeNumber(tool.failed)} failed, ${wholeNumber(tool.unfinished)} unfinished`,
              cells: [
                compactNumber(tool.calls),
                <span key="failed" className={cn(tool.failed > 0 && 'text-destructive')}>
                  {percentText(tool.failed, tool.calls)}
                </span>,
                tool.durationP50 === undefined ? '–' : durationText(tool.durationP50)
              ]
            }))}
          />
        </StatsCard>
        <StatsCard title="Run outcomes" detail="latest run of sessions that ended in range">
          <Outcomes view={view} report={report} filter={filter} />
        </StatsCard>
      </div>
    </>
  )
}

/**
 * The Stats tab (`?view=stats`): OpenCode's own numbers for a range (default the last 7 days,
 * `?range=` / `?from=&to=`) and project (`?project=`, shared with Agents), with no state of
 * Fleet's. Headline tiles, then bars per hour / day / week (sessions started, prompts),
 * both by project (prompts from `/api/fleet/stats/projects`, the same projects and inks for
 * both), time of day (prompts by weekday × hour and by hour, `/api/fleet/stats/hours`), more bars
 * (steps, tokens by model, tool calls) and whole-range tables (models, tools, run
 * outcomes). Sessions started and outcomes come from Fleet's session list, the rest from
 * OpenCode's stats. An open session docks beside it (`SessionSplit`). Keys: `[` / `]` a shorter
 * / longer preset, `/` the filter.
 */
export function StatsPage() {
  const { view, nav } = useFleet()
  const filterRef = useRef<ProjectFilterHandle>(null)
  const [timeZone] = useState(browserTimeZone)
  const project = statsProjectID(view, nav.project)
  const state = useStats(statsUrl(nav.period, project, timeZone))
  const hours = useStatsHours(statsHoursUrl(nav.period, project, timeZone))
  const projects = useStatsProjects(statsProjectsUrl(nav.period, timeZone))
  const report = shownValue(state)

  useKeys({
    '/': () => filterRef.current?.open(),
    '[': () => nav.setPeriod(StatsPeriod.Preset({ preset: steppedPreset(nav.period, -1) })),
    ']': () => nav.setPeriod(StatsPeriod.Preset({ preset: steppedPreset(nav.period, 1) }))
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="@container min-h-0 min-w-0 flex-1 lg:overflow-y-auto">
        <h2 className="sr-only">Stats</h2>
        <div className="flex flex-col gap-3 p-3 lg:p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <RangePicker timeZone={timeZone} />
            <ProjectFilter filterRef={filterRef} />
            <StatusLine state={state} report={report} />
          </div>
          {report === undefined ? (
            state.status === 'failed' ? null : (
              <StatsSkeleton />
            )
          ) : (
            <div
              className={cn(
                'flex flex-col gap-3 transition-opacity',
                state.status === 'loading' && 'opacity-50'
              )}
            >
              <StatsBody report={report} hours={hours} projects={projects} filter={nav.project} />
            </div>
          )}
        </div>
      </div>
      <SessionSplit />
    </div>
  )
}
