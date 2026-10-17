'use client'

import { useState } from 'react'
import { useVltra } from '@/app/vltra-context'
import { cardGrid, StatsCard, wide } from '@/app/stats-card'
import { CalendarHeatmap, HourHeatmap } from '@/app/stats-heatmaps'
import { browserTimeZone } from '@/app/use-stats'
import { Skeleton } from '@/components/ui/skeleton'
import { hourGrid, yearWeeks } from '@/lib/data/vltra/stats-view'

// The Stats tab before its numbers arrive: the same tiles and cards (titles, order, sizes) as the
// loaded page, so nothing moves when they fill in. No chart library: the tab's lazy chunk shows it
// while it loads too.

/** What a card holds, for its placeholder's height (see `TimeBars`, `ShareTable`, the heatmaps). */
type CardBody =
  | { readonly kind: 'bars'; readonly legendLines: 0 | 1 | 2 }
  | { readonly kind: 'calendar' }
  | { readonly kind: 'heatmap' }
  | { readonly kind: 'scatter' }
  | { readonly kind: 'table'; readonly rows: number }

type CardSpec = {
  readonly title: string
  readonly detail?: string
  readonly body: CardBody
  readonly wide?: boolean
}

const bars = (legendLines: 0 | 1 | 2): CardBody => ({ kind: 'bars', legendLines })

const table = (rows: number): CardBody => ({ kind: 'table', rows })

/** The loaded page's cards, in its order (`stats-page.test.tsx` holds them to it). */
export const skeletonCards: ReadonlyArray<CardSpec> = [
  {
    title: 'Done',
    detail: "sessions marked done by project, by their last run's end",
    body: bars(1)
  },
  { title: 'Sessions started', detail: "by project, from Vltra's list", body: bars(1) },
  { title: 'Prompts', detail: 'your messages, by project', body: bars(1) },
  {
    title: 'Last year',
    detail: 'sessions done per day, whatever the range',
    body: { kind: 'calendar' }
  },
  { title: 'Time of day', detail: 'by weekday and hour', body: { kind: 'heatmap' } },
  { title: 'By hour of day', detail: 'whole range', body: bars(0) },
  { title: 'Steps', detail: 'model calls', body: bars(0) },
  { title: 'Steps per prompt', detail: 'how much the agents do per message', body: bars(0) },
  { title: 'Tokens by model', detail: 'excl. cache reads', body: bars(2) },
  { title: 'Model share', detail: "% of each bar's tokens", body: bars(2) },
  { title: 'Tool calls', body: bars(1) },
  { title: 'Tool failure rate', detail: '% of tool calls that failed', body: bars(0) },
  { title: 'Cache hits', detail: 'cache reads, % of all input', body: bars(0) },
  {
    title: 'Run outcomes over time',
    detail: 'latest run of each session, by its end',
    body: bars(1)
  },
  {
    title: 'Session length',
    detail: 'sessions started, creation to latest run end',
    body: bars(0)
  },
  {
    title: 'Subagents per session',
    detail: 'sessions started, by subagents run',
    body: bars(0)
  },
  {
    title: 'Tokens × length',
    detail: 'a dot per session started (log scales)',
    body: { kind: 'scatter' }
  },
  { title: 'Models', detail: 'whole range', body: table(10) },
  { title: 'Tools', detail: 'whole range; median duration', body: table(10), wide: true },
  {
    title: 'Run outcomes',
    detail: 'latest run of sessions that ended in range',
    body: table(3)
  }
]

/** The year calendar with no steps yet, pulsing, at its final size (no hover tips). */
export function CalendarPlaceholder() {
  const { now } = useVltra()
  const [timeZone] = useState(browserTimeZone)
  const [weeks] = useState(() => yearWeeks(new Map(), now, timeZone))

  return (
    <div role="status" aria-label="Loading the year" className="pointer-events-none animate-pulse">
      <div aria-hidden="true">
        <CalendarHeatmap weeks={weeks} noun="done" />
      </div>
    </div>
  )
}

/** The weekday × hour grid with nothing in it yet, pulsing, at its final size. */
export function HeatmapPlaceholder() {
  const [grid] = useState(() => hourGrid([], 'UTC'))

  return (
    <div role="status" aria-label="Loading hours" className="pointer-events-none animate-pulse">
      <div aria-hidden="true">
        <HourHeatmap grid={grid} noun="prompts" />
      </div>
    </div>
  )
}

/** A bar chart's box (`TimeBars`, `HourBars`, `CategoryBars`): the plot, then legend lines. */
export function BarsPlaceholder({ legendLines = 0 }: { readonly legendLines?: 0 | 1 | 2 }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-44" />
      {legendLines === 0 ? null : (
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-2/3" />
          {legendLines === 2 ? <Skeleton className="h-4 w-1/3" /> : null}
        </div>
      )}
    </div>
  )
}

function CardPlaceholder({ body }: { readonly body: CardBody }) {
  switch (body.kind) {
    case 'bars':
      return <BarsPlaceholder legendLines={body.legendLines} />
    case 'calendar':
      return <CalendarPlaceholder />
    case 'heatmap':
      return <HeatmapPlaceholder />
    case 'scatter':
      return <Skeleton className="h-56" />
    case 'table':
      return (
        <div className="flex flex-col gap-[7px]">
          <Skeleton className="h-4" />
          {Array.from({ length: body.rows }, (_, index) => (
            <Skeleton key={index} className="h-6" />
          ))}
        </div>
      )
  }
}

/** A tile's lines at their text heights: label, value, detail, sparkline (`Tile`). */
function TilePlaceholder() {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border px-3 py-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-7 w-20" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-1 h-6" />
    </div>
  )
}

/** The seven tiles and every card, empty. */
export function StatsSkeleton() {
  return (
    <div role="status" aria-label="Loading stats" className="flex flex-col gap-3">
      {/* Placeholders only: the status names it; the frames stay out of the accessibility tree. */}
      <div aria-hidden="true" className="contents">
        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4 @5xl:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <TilePlaceholder key={index} />
          ))}
        </div>
        <div className={cardGrid}>
          {skeletonCards.map(card => (
            <StatsCard
              key={card.title}
              title={card.title}
              detail={card.detail}
              className={card.wide === true ? wide : ''}
            >
              <CardPlaceholder body={card.body} />
            </StatsCard>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The whole tab while its code loads (`current-tab.tsx`): the controls' row as placeholders, then
 * `StatsSkeleton`, in the page's own frame.
 */
export function StatsPageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="@container min-h-0 min-w-0 flex-1 lg:overflow-y-auto">
        <div className="flex flex-col gap-3 p-3 lg:p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Skeleton className="h-7 w-60" />
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-3 w-40" />
          </div>
          <StatsSkeleton />
        </div>
      </div>
    </div>
  )
}
