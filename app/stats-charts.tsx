'use client'

import { Option, Predicate, Schema } from 'effect'
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { YAxisProps } from 'recharts'
import {
  bucketLabel,
  bucketTitle,
  changeText,
  compactNumber,
  durationText,
  wholeNumber
} from '@/app/stats-format'
import { ChartContainer } from '@/components/ui/chart'
import { inkLevel, restKey, weekdays } from '@/lib/data/fleet/stats-view'
import type {
  CalendarDay,
  CategoryCount,
  ChartRow,
  HourGrid,
  SeriesChart,
  SessionPoint
} from '@/lib/data/fleet/stats-view'
import type { StatsUnit } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

// The Stats tab's building blocks: bordered cards, number tiles, bars over time (Recharts) and
// share bars (plain CSS). Ink colours only; red for failures.

const inks = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
]

/** A series' colour: ink by rank, the rest faint, unless the chart names its own. */
export const seriesColor = (key: string, index: number): string =>
  key === restKey ? 'var(--chart-rest)' : (inks[index % inks.length] ?? 'currentColor')

/** A titled card, like the Projects cards: hairline border, title row, content. */
export function StatsCard({
  title,
  detail,
  className,
  children
}: {
  readonly title: string
  /** Muted text after the title: what is counted. */
  readonly detail?: string
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <section aria-label={title} className={cn('bg-background min-w-0 border', className)}>
      <h3 className="flex items-baseline gap-2 border-b px-3 py-2">
        {/* The title stays on one line; the detail gives way (in full on hover). */}
        <span className="shrink-0 font-semibold whitespace-nowrap">{title}</span>
        {detail === undefined ? null : (
          <span title={detail} className="text-muted-foreground min-w-0 truncate text-xs">
            {detail}
          </span>
        )}
      </h3>
      <div className="p-3">{children}</div>
    </section>
  )
}

/** One headline number, with what it counts under it. */
/** A tile's values over the range, each with its bar's name (`Tue, Oct 6`). */
export type TrendLine = {
  readonly values: ReadonlyArray<number>
  readonly labels: ReadonlyArray<string>
}

/** The sparkline's height in its own units (it stretches to the tile's width). */
const sparkHeight = 24

/**
 * A word-sized line of a tile's values over the range (Tufte's sparkline), no axes. Hovering picks
 * the nearest bar: a guide, a dot, and its name and value above.
 */
export function Sparkline({ trend }: { readonly trend: TrendLine }) {
  const { values, labels } = trend
  const [hovered, setHovered] = useState<number>()
  const largest = Math.max(0, ...values)

  if (values.length < 2 || largest === 0) return null

  const step = 100 / (values.length - 1)
  const y = (value: number) => sparkHeight - 1 - ((sparkHeight - 2) * value) / largest

  const points = values
    .map((value, index) => `${(index * step).toFixed(2)},${y(value).toFixed(2)}`)
    .join(' ')

  const value = hovered === undefined ? undefined : values[hovered]

  return (
    <div
      className="relative"
      onMouseMove={event => {
        const box = event.currentTarget.getBoundingClientRect()
        const share = box.width > 0 ? (event.clientX - box.left) / box.width : 0
        const index = Math.round(share * (values.length - 1))

        setHovered(Math.max(0, Math.min(values.length - 1, index)))
      }}
      onMouseLeave={() => setHovered(undefined)}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 100 ${sparkHeight}`}
        preserveAspectRatio="none"
        className="text-foreground/70 h-6 w-full"
      >
        {hovered === undefined ? null : (
          <line
            x1={hovered * step}
            x2={hovered * step}
            y1={0}
            y2={sparkHeight}
            stroke="var(--border)"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {hovered === undefined || value === undefined ? null : (
        <>
          {/* Out of the stretched SVG, so the dot stays round. */}
          <span
            aria-hidden="true"
            className="bg-foreground absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${hovered * step}%`, top: `${(100 * y(value)) / sparkHeight}%` }}
          />
          <span
            role="tooltip"
            className="border-border bg-popover text-popover-foreground pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 border px-2 py-1 font-mono text-xs whitespace-nowrap tabular-nums"
            style={{ left: `clamp(4.5rem, ${hovered * step}%, calc(100% - 4.5rem))` }}
          >
            {labels[hovered]} · {compactNumber(value)}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * One headline number, with what it counts under it, its change against the as long range before
 * (`+12%`, neither good nor bad, so in plain ink) and a sparkline of the range.
 */
export function Tile({
  label,
  value,
  detail,
  title,
  change,
  trend
}: {
  readonly label: string
  readonly value: string
  readonly detail?: ReactNode
  /** Exact numbers on hover. */
  readonly title?: string
  /** Percent against the previous range. */
  readonly change?: number | undefined
  readonly trend?: TrendLine
}) {
  return (
    <div title={title} className="flex min-w-0 flex-col gap-0.5 border px-3 py-2">
      <dt className="text-muted-foreground truncate text-xs">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {change === undefined ? null : (
          <span className="text-muted-foreground text-xs tabular-nums" title="vs the range before">
            {changeText(change)}
          </span>
        )}
      </dd>
      {detail === undefined ? null : (
        <dd className="text-muted-foreground truncate text-xs">{detail}</dd>
      )}
      {trend === undefined ? null : (
        <dd className="mt-1">
          <Sparkline trend={trend} />
        </dd>
      )}
    </div>
  )
}

const tick = { fill: 'var(--muted-foreground)', fontSize: 11 }

/** A value axis from zero: to `max` in quarters when the values have a top (shares), else fitted. */
const valueAxis = (max: number | undefined): Pick<YAxisProps, 'domain' | 'ticks'> =>
  max === undefined
    ? { domain: [0, 'auto'] }
    : { domain: [0, max], ticks: [0, max / 4, max / 2, (3 * max) / 4, max] }

/**
 * Bars over time, one stacked segment per series, a tooltip per bar (hover, tap or arrow keys) and
 * a legend when there is more than one series. `colors` overrides the ink colours by series key.
 */
export function TimeBars({
  chart,
  unit,
  timeZone,
  format,
  max,
  colors = {}
}: {
  readonly chart: SeriesChart
  readonly unit: StatsUnit
  readonly timeZone: string
  /** Values on the axis and in the tooltip. */
  readonly format: (value: number) => string
  /** The axis' top when the values have one (100 for shares); else it fits the data. */
  readonly max?: number
  readonly colors?: Readonly<Partial<Record<string, string>>>
}) {
  const color = (key: string, index: number) => colors[key] ?? seriesColor(key, index)
  const stacked = chart.series.length > 1

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ChartContainer className="h-44 w-full">
        <BarChart
          data={[...chart.rows]}
          accessibilityLayer
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          barCategoryGap="12%"
        >
          <CartesianGrid vertical={false} stroke="var(--hairline)" />
          <XAxis
            dataKey="start"
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tick={tick}
            tickMargin={6}
            minTickGap={12}
            tickFormatter={(value: number) => bucketLabel(value, unit, timeZone)}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tick={tick}
            allowDecimals={false}
            {...valueAxis(max)}
            tickFormatter={(value: number) => format(value)}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent)' }}
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              if (active !== true || payload === undefined || payload.length === 0) return null

              const values = payload.flatMap(item =>
                Predicate.isNumber(item.value) && item.value > 0
                  ? [{ name: String(item.name), value: item.value, color: item.color }]
                  : []
              )

              const total = values.reduce((sum, item) => sum + item.value, 0)

              return (
                <div className="border-border bg-popover text-popover-foreground border px-2.5 py-1.5 font-mono text-xs">
                  <p className="text-muted-foreground mb-1">
                    {Predicate.isNumber(label) ? bucketTitle(label, unit, timeZone) : null}
                  </p>
                  {values.length === 0 ? <p>none</p> : null}
                  {values.toReversed().map(item => (
                    <p key={item.name} className="flex items-center gap-2 tabular-nums">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0"
                        style={{ background: item.color }}
                      />
                      <span className="max-w-64 truncate">{item.name}</span>
                      <span className="ml-auto pl-3">{format(item.value)}</span>
                    </p>
                  ))}
                  {stacked && values.length > 1 ? (
                    <p className="mt-1 flex border-t pt-1 tabular-nums">
                      <span>total</span>
                      <span className="ml-auto pl-3">{format(total)}</span>
                    </p>
                  ) : null}
                </div>
              )
            }}
          />
          {chart.series.map((series, index) => (
            <Bar
              key={series.key}
              name={series.name}
              dataKey={(row: ChartRow) => row.values[index] ?? 0}
              stackId="bars"
              fill={color(series.key, index)}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {stacked ? (
        <ul aria-label="Legend" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {chart.series.map((series, index) => (
            <li
              key={series.key}
              className="text-muted-foreground flex min-w-0 items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: color(series.key, index) }}
              />
              <span className="max-w-56 truncate">{series.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** One row of a share table: a label, a bar of its share of the largest, then figures. */
export type ShareRow = {
  readonly key: string
  readonly label: string
  /** What the bar measures. */
  readonly value: number
  readonly cells: ReadonlyArray<ReactNode>
  /** Hover text. */
  readonly title?: string
  /** Bar in red (e.g. a failure share). */
  readonly alarm?: boolean
}

/** A table of shares: label, bar (to the largest value), then one cell per column. */
export function ShareTable({
  label,
  columns,
  rows,
  empty
}: {
  readonly label: string
  readonly columns: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ShareRow>
  readonly empty: string
}) {
  const largest = Math.max(0, ...rows.map(row => row.value))

  if (rows.length === 0) return <p className="text-muted-foreground text-xs">{empty}</p>

  return (
    <table aria-label={label} className="w-full table-fixed text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th
            className={cn('pb-1 text-left font-normal', columns.length > 2 ? 'w-[45%]' : 'w-[60%]')}
          >
            {label}
          </th>
          {columns.map(column => (
            <th key={column} className="pb-1 text-right font-normal">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.key} title={row.title} className="border-hairline border-t">
            <td className="py-1 pr-2">
              <span className="block truncate">{row.label}</span>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 block h-1',
                  row.alarm === true ? 'bg-destructive' : 'bg-foreground/70'
                )}
                style={{ width: largest === 0 ? 0 : `${(row.value / largest) * 100}%` }}
              />
            </td>
            {row.cells.map((cell, index) => (
              <td key={columns[index] ?? index} className="py-1 text-right tabular-nums">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const twoDigits = (hour: number) => String(hour).padStart(2, '0')

/** The heatmaps' five inks (level 1–5), even steps of lightness; level 0 is a hairline square. */
const heatInks = [
  '',
  'var(--chart-5)',
  'var(--chart-4)',
  'var(--chart-3)',
  'var(--chart-2)',
  'var(--chart-1)'
]

const heatCell = (value: number, largest: number) => {
  const ink = heatInks[inkLevel(value, largest)]

  return ink === undefined || ink === '' ? undefined : { background: ink }
}

type Tip = { readonly text: string; readonly left: number; readonly top: number }

/** Half a tip's usual width: how far from the card's edges its centre stays. */
const tipHalfWidth = 130

/**
 * Hover tips for a heatmap's cells, like the charts' tooltips: any descendant with `data-tip`
 * shows its text above it (one listener for the whole grid, kept inside the card's edges).
 */
export function HeatTips({ children }: { readonly children: ReactNode }) {
  const [tip, setTip] = useState<Tip>()

  const show = (target: EventTarget, container: HTMLElement) => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null
    const text = cell?.dataset.tip

    if (cell === null || text === undefined) {
      setTip(undefined)

      return
    }

    const box = container.getBoundingClientRect()
    const rect = cell.getBoundingClientRect()
    const center = rect.left + rect.width / 2 - box.left
    const right = Math.max(tipHalfWidth, box.width - tipHalfWidth)

    setTip({
      text,
      left: Math.min(Math.max(center, tipHalfWidth), right),
      top: rect.top - box.top
    })
  }

  return (
    <div
      className="relative"
      onMouseOver={event => show(event.target, event.currentTarget)}
      onMouseLeave={() => setTip(undefined)}
    >
      {children}
      {tip === undefined ? null : (
        <div
          role="tooltip"
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full border px-2.5 py-1.5 font-mono text-xs whitespace-nowrap tabular-nums"
          style={{ left: tip.left, top: tip.top - 6 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}

/**
 * Counts by weekday (rows, Monday first) and hour of the day (columns): ink as dark as the busiest
 * hour, empty hours a hairline square; each square's count on hover.
 */
export function HourHeatmap({
  grid,
  noun
}: {
  readonly grid: HourGrid
  /** What is counted, plural (`prompts`). */
  readonly noun: string
}) {
  const largest = Math.max(0, ...grid.cells.flat())

  return (
    <HeatTips>
      <div
        role="table"
        aria-label={`${noun} by weekday and hour`}
        className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 text-[11px]"
      >
        <div role="row" className="contents">
          <span role="columnheader" />
          {grid.byHour.map((_, hour) => (
            <span
              key={hour}
              role="columnheader"
              className="text-muted-foreground text-center tabular-nums"
            >
              {hour % 3 === 0 ? twoDigits(hour) : ''}
            </span>
          ))}
        </div>
        {grid.cells.map((row, weekday) => (
          <div key={weekdays[weekday]} role="row" className="contents">
            <span role="rowheader" className="text-muted-foreground self-center">
              {weekdays[weekday]}
            </span>
            {row.map((value, hour) => (
              <span
                key={hour}
                role="cell"
                data-tip={`${weekdays[weekday]} ${twoDigits(hour)}:00–${twoDigits((hour + 1) % 24)}:00 · ${compactNumber(value)} ${noun}`}
                aria-label={`${weekdays[weekday]} ${twoDigits(hour)}:00: ${value}`}
                className={cn('h-5', value === 0 && 'bg-hairline/50')}
                style={heatCell(value, largest)}
              />
            ))}
          </div>
        ))}
      </div>
    </HeatTips>
  )
}

type HourDatum = { readonly hour: number; readonly value: number }

/** The range added up by hour of the day: 24 bars, `00`–`23`. */
export function HourBars({ grid, noun }: { readonly grid: HourGrid; readonly noun: string }) {
  const data: Array<HourDatum> = grid.byHour.map((value, hour) => ({ hour, value }))

  return (
    <ChartContainer className="h-44 w-full">
      <BarChart
        data={data}
        accessibilityLayer
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        barCategoryGap="12%"
      >
        <CartesianGrid vertical={false} stroke="var(--hairline)" />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
          tick={tick}
          tickMargin={6}
          interval={2}
          tickFormatter={(value: number) => twoDigits(value)}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          tick={tick}
          allowDecimals={false}
          tickFormatter={(value: number) => compactNumber(value)}
        />
        <Tooltip
          cursor={{ fill: 'var(--accent)' }}
          isAnimationActive={false}
          content={({ active, payload, label }) => {
            const value = payload?.[0]?.value

            if (active !== true || !Predicate.isNumber(label) || !Predicate.isNumber(value)) {
              return null
            }

            return (
              <div className="border-border bg-popover text-popover-foreground border px-2.5 py-1.5 font-mono text-xs tabular-nums">
                <p className="text-muted-foreground mb-1">
                  {twoDigits(label)}:00–{twoDigits((label + 1) % 24)}:00
                </p>
                <p>
                  {compactNumber(value)} {noun}
                </p>
              </div>
            )
          }}
        />
        <Bar name={noun} dataKey="value" fill="var(--chart-1)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

/** A distribution as bars: one per labelled bin (`<1m`, `1–5m`, …), the count on hover. */
export function CategoryBars({
  data,
  noun
}: {
  readonly data: ReadonlyArray<CategoryCount>
  /** What is counted, plural (`sessions`). */
  readonly noun: string
}) {
  return (
    <ChartContainer className="h-44 w-full">
      <BarChart
        data={[...data]}
        accessibilityLayer
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        barCategoryGap="12%"
      >
        <CartesianGrid vertical={false} stroke="var(--hairline)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
          tick={tick}
          tickMargin={6}
          minTickGap={6}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          tick={tick}
          allowDecimals={false}
          tickFormatter={(value: number) => compactNumber(value)}
        />
        <Tooltip
          cursor={{ fill: 'var(--accent)' }}
          isAnimationActive={false}
          content={({ active, payload, label }) => {
            const value = payload?.[0]?.value

            if (active !== true || !Predicate.isNumber(value)) return null

            return (
              <div className="border-border bg-popover text-popover-foreground border px-2.5 py-1.5 font-mono text-xs tabular-nums">
                <p className="text-muted-foreground mb-1">{String(label)}</p>
                <p>
                  {compactNumber(value)} {noun}
                </p>
              </div>
            )
          }}
        />
        <Bar name={noun} dataKey="count" fill="var(--chart-1)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

/** Recharts hands the hovered dot's datum back untyped. */
const decodePointId = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }))

/**
 * Sessions as dots: open time across, tokens up, both on log scales (they span orders of
 * magnitude). Big-and-long sit top right; long but small ones (stuck or idle) bottom right.
 */
export function SessionScatter({ points }: { readonly points: ReadonlyArray<SessionPoint> }) {
  return (
    <ChartContainer className="h-56 w-full">
      <ScatterChart accessibilityLayer margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--hairline)" />
        <XAxis
          type="number"
          dataKey="length"
          scale="log"
          domain={['auto', 'auto']}
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
          tick={tick}
          tickMargin={6}
          tickFormatter={(value: number) => durationText(value)}
        />
        <YAxis
          type="number"
          dataKey="tokens"
          scale="log"
          domain={['auto', 'auto']}
          width={44}
          tickLine={false}
          axisLine={false}
          tick={tick}
          tickFormatter={(value: number) => compactNumber(value)}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border)' }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const hovered = decodePointId(payload?.[0]?.payload)

            const point = Option.isNone(hovered)
              ? undefined
              : points.find(candidate => candidate.id === hovered.value.id)

            if (active !== true || point === undefined) return null

            return (
              <div className="border-border bg-popover text-popover-foreground max-w-72 border px-2.5 py-1.5 font-mono text-xs tabular-nums">
                <p className="truncate">{point.title}</p>
                <p className="text-muted-foreground">
                  {point.project} · {durationText(point.length)} · {compactNumber(point.tokens)}{' '}
                  tokens
                </p>
              </div>
            )
          }}
        />
        <Scatter
          data={[...points]}
          fill="var(--foreground)"
          fillOpacity={0.55}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ChartContainer>
  )
}

/** Weeks the calendar keeps in a narrow card (under 36rem). */
const narrowWeeks = 26

/** `Tue, Oct 6, 2026` for a `YYYY-MM-DD` day. */
const dayFormat = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`))

const monthFormat = (date: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`)
  )

/**
 * A year of days like GitHub's contributions: a column per week (Monday on top) sharing the full
 * width, square days, darker for busier days in five even steps, month names over the weeks they
 * start; each day's count on hover. In a narrow card, the last 26 weeks.
 */
export function CalendarHeatmap({
  weeks,
  noun
}: {
  readonly weeks: ReadonlyArray<ReadonlyArray<CalendarDay>>
  readonly noun: string
}) {
  const largest = Math.max(0, ...weeks.flat().map(day => day.steps))

  return (
    <HeatTips>
      <div className="@container/calendar flex min-w-0 gap-1 text-[11px]">
        {/* Stretches to the weeks' height, so its seven rows line up with their squares. */}
        <div className="text-muted-foreground grid w-7 shrink-0 grid-rows-[1rem_repeat(7,minmax(0,1fr))] gap-[2px]">
          <span />
          {weekdays.map((day, index) => (
            // Out of the flow, so the labels never make the rows taller than the squares.
            <span key={day} className="relative">
              {index % 2 === 0 ? (
                <span className="absolute inset-y-0 left-0 flex items-center text-[10px]">
                  {day}
                </span>
              ) : null}
            </span>
          ))}
        </div>
        <div
          role="table"
          aria-label={`${noun} per day, last year`}
          className="grid min-w-0 flex-1 auto-cols-[minmax(0,1fr)] grid-flow-col gap-[2px]"
        >
          {weeks.map((week, index) => {
            const first = week[0]?.date ?? ''
            const previous = weeks[index - 1]?.[0]?.date ?? ''
            // In a narrow card, the last half year only, so the squares stay big enough to see.
            const older = index < weeks.length - narrowWeeks
            const newMonth = index === 0 || first.slice(0, 7) !== previous.slice(0, 7)
            // The half year's first week names its month too, but only while it starts the row.
            const narrowStart = !newMonth && index === weeks.length - narrowWeeks

            return (
              <div
                key={first}
                role="row"
                className={cn('grid content-start gap-[2px]', older && '@max-xl/calendar:hidden')}
              >
                {/* The month name overflows into the next weeks without widening its own. */}
                <span role="columnheader" className="text-muted-foreground relative h-4">
                  {newMonth || narrowStart ? (
                    <span
                      className={cn(
                        'absolute left-0 whitespace-nowrap',
                        narrowStart && '@xl/calendar:hidden'
                      )}
                    >
                      {monthFormat(first)}
                    </span>
                  ) : null}
                </span>
                {week.map(day => (
                  <span
                    key={day.date}
                    role="cell"
                    data-tip={`${dayFormat(day.date)} · ${wholeNumber(day.steps)} ${noun}`}
                    aria-label={`${day.date}: ${day.steps}`}
                    className={cn('aspect-square', day.steps === 0 && 'bg-hairline/50')}
                    style={heatCell(day.steps, largest)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </HeatTips>
  )
}
