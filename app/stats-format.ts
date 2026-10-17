import type { StatsUnit } from '@/lib/data/vltra/types'

// Display formatting for the Stats tab. Pure; times are epoch milliseconds, shown in `timeZone`
// (the browser's, which the report was cut in).

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const whole = new Intl.NumberFormat('en-US')

/** `806`, `15.7K`, `4.4B`. */
export const compactNumber = (value: number): string => compact.format(value)

/** `15,661`: exact, for hover text. */
export const wholeNumber = (value: number): string => whole.format(Math.round(value))

/** `45ms`, `1.2s`, `3m`, `2.5h`, `3d`. */
export const durationText = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`

  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`

  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`

  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(ms < 36_000_000 ? 1 : 0)}h`

  return `${Math.round(ms / 86_400_000)}d`
}

/** `12%` for chart axes and tooltips (values already in percent). */
export const percentValue = (value: number): string => `${Math.round(value)}%`

/** `+12%`, `−8%`, `±0%`, and past doubling `3×`: a change against the previous range. */
export const changeText = (percent: number): string => {
  if (percent >= 100) return `${compact.format(1 + percent / 100)}×`

  const rounded = Math.round(percent)

  if (rounded === 0) return '±0%'

  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`
}

/** `12%`, `<1%`, `0%`. */
export const percentText = (part: number, total: number): string => {
  if (total === 0 || part === 0) return '0%'

  const percent = (part / total) * 100

  return percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

const formatter = (timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone, ...options })

const hourFormat = (timeZone: string) =>
  formatter(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** `Tue 6` (en-US alone would say `6 Tue`). */
const dayLabel = (start: number, timeZone: string) => {
  const parts = new Map(
    formatter(timeZone, { weekday: 'short', day: 'numeric' })
      .formatToParts(start)
      .map(part => [part.type, part.value])
  )

  return `${parts.get('weekday') ?? ''} ${parts.get('day') ?? ''}`
}

/**
 * A bar's axis label: `14:00` (hours, also for a first bar that starts mid-hour), `Tue 6` (days),
 * `Oct 5` (weeks, by their Monday).
 */
export const bucketLabel = (start: number, unit: StatsUnit, timeZone: string): string => {
  switch (unit) {
    case 'hour':
      return `${formatter(timeZone, { hour: '2-digit', hourCycle: 'h23' }).format(start)}:00`
    case 'day':
      return dayLabel(start, timeZone)
    case 'week':
      return formatter(timeZone, { month: 'short', day: 'numeric' }).format(start)
  }
}

/** A bar's hover title: `Tue, Oct 6, 14:00`, `Tue, Oct 6`, `week of Mon, Oct 5`. */
export const bucketTitle = (start: number, unit: StatsUnit, timeZone: string): string => {
  const date = formatter(timeZone, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    start
  )

  switch (unit) {
    case 'hour':
      return `${date}, ${hourFormat(timeZone).format(start)}`
    case 'day':
      return date
    case 'week':
      return `week of ${date}`
  }
}

/** The calendar day (`YYYY-MM-DD`) `at` falls on in `timeZone`. */
export const calendarDay = (at: number, timeZone: string): string => {
  const parts = new Map(
    formatter(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(at)
      .map(part => [part.type, part.value])
  )

  return `${parts.get('year') ?? '0000'}-${parts.get('month') ?? '01'}-${parts.get('day') ?? '01'}`
}

/** The range a report covers: `Sep 30 – Oct 6` (the end is exclusive, so its last moment). */
export const rangeText = (from: number, to: number, timeZone: string): string => {
  const day = formatter(timeZone, { month: 'short', day: 'numeric' })
  const first = day.format(from)
  const last = day.format(Math.max(from, to - 1))

  return first === last ? first : `${first} – ${last}`
}
