'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { compactNumber, wholeNumber } from '@/app/stats-format'
import { inkLevel, weekdays } from '@/lib/data/vltra/stats-view'
import type { CalendarDay, HourGrid } from '@/lib/data/vltra/stats-view'
import { cn } from '@/lib/utils'

// The Stats tab's heatmaps (weekday × hour, the year calendar) in plain CSS grids, with hover
// tips. No chart library, so the tab's skeleton can draw them empty at their final size.

export const twoDigits = (hour: number) => String(hour).padStart(2, '0')

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
  const largest = Math.max(0, ...weeks.flat().map(day => day.count))

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
                    data-tip={`${dayFormat(day.date)} · ${wholeNumber(day.count)} ${noun}`}
                    aria-label={`${day.date}: ${day.count}`}
                    className={cn('aspect-square', day.count === 0 && 'bg-hairline/50')}
                    style={heatCell(day.count, largest)}
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
