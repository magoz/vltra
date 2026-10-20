'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { changeText, compactNumber } from '@/app/stats-format'
import { cn } from '@/lib/utils'

// The Stats tab's frames: bordered cards and number tiles with their sparklines. No chart
// library, so the tab's skeleton can use them before the charts load.

/** A titled card, like the Projects cards: hairline border, title row, content. */
export function StatsCard({
  title,
  detail,
  actions,
  className,
  children
}: {
  readonly title: string
  /** Muted text after the title: what is counted. */
  readonly detail?: string | undefined
  /** Controls at the title row's end (the year calendar's layers). */
  readonly actions?: ReactNode
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <section aria-label={title} className={cn('bg-background min-w-0 border', className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="flex min-w-0 flex-1 items-baseline gap-2">
          {/* The title stays on one line; the detail gives way (in full on hover). */}
          <span className="shrink-0 font-semibold whitespace-nowrap">{title}</span>
          {detail === undefined ? null : (
            <span title={detail} className="text-muted-foreground min-w-0 truncate text-xs">
              {detail}
            </span>
          )}
        </h3>
        {actions}
      </div>
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

/** The tiles' grid: two, four, then all eight in a row. */
export const tileGrid = 'grid grid-cols-2 gap-2 @lg:grid-cols-4 @5xl:grid-cols-8'

/**
 * The cards' grid by the page's own width: one column, two from 56rem, three from 80rem (two
 * columns are too wide on a big screen). `wide` cards take two of three: the tools table (its row
 * filled by the outcomes table).
 */
export const cardGrid = 'grid gap-3 @4xl:grid-cols-2 @7xl:grid-cols-3'

export const wide = '@7xl:col-span-2'
