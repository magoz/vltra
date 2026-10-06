'use client'

import { Option, Predicate, Schema } from 'effect'
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
import { bucketLabel, bucketTitle, compactNumber, durationText } from '@/app/stats-format'
import { twoDigits } from '@/app/stats-heatmaps'
import { ChartContainer } from '@/components/ui/chart'
import { restKey } from '@/lib/data/fleet/stats-view'
import type {
  CategoryCount,
  ChartRow,
  HourGrid,
  SeriesChart,
  SessionPoint
} from '@/lib/data/fleet/stats-view'
import type { StatsUnit } from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

// The Stats tab's charts: bars over time (Recharts), distributions, the scatter and share bars
// (plain CSS). Ink colours only; red for failures. Cards and tiles are in `stats-card.tsx`, the
// heatmaps in `stats-heatmaps.tsx`.

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
