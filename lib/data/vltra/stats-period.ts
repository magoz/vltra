import { Data, Option, Schema } from 'effect'

// The Stats tab's time range, as it travels in URLs (the page's `?range=` or `?from=&to=`, and
// `GET /api/vltra/stats`). Pure, so the page and the route read the same thing.

/** Ranges up to now: the last 24 hours, today and the days before it, or everything. */
export const statsPresets = ['24h', '7d', '30d', '90d', 'all'] as const

export const StatsPreset = Schema.Literals(statsPresets)

export type StatsPreset = typeof StatsPreset.Type

export const defaultStatsPreset: StatsPreset = '7d'

/** `YYYY-MM-DD` as numbers (month 1–12), when it names a real day. */
export const calendarDayParts = (
  value: string
): Option.Option<{ readonly year: number; readonly month: number; readonly day: number }> => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (match === null) return Option.none()

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? Option.some({ year, month, day })
    : Option.none()
}

/** A calendar day, `YYYY-MM-DD`, in the browser's time zone. */
export const CalendarDay = Schema.String.check(
  Schema.makeFilter(value => Option.isSome(calendarDayParts(value)) || 'Expected a YYYY-MM-DD day')
)

/** A preset, or the calendar days `from` through `to` (both included). */
export type StatsPeriod = Data.TaggedEnum<{
  Preset: { readonly preset: StatsPreset }
  Days: { readonly from: string; readonly to: string }
}>

export const StatsPeriod = Data.taggedEnum<StatsPeriod>()

export const defaultStatsPeriod: StatsPeriod = StatsPeriod.Preset({ preset: defaultStatsPreset })

export const rangeParam = 'range'

export const fromParam = 'from'

export const toParam = 'to'

const decodePreset = Schema.decodeUnknownOption(StatsPreset)

const decodeDay = Schema.decodeUnknownOption(CalendarDay)

type Params = { readonly get: (name: string) => string | null }

/**
 * The period a query names: days when `from` and `to` are both valid days in order, else the
 * `range` preset, else the default (7 days). Anything malformed falls back rather than failing.
 */
export const statsPeriodOf = (params: Params): StatsPeriod => {
  const from = decodeDay(params.get(fromParam))
  const to = decodeDay(params.get(toParam))

  if (Option.isSome(from) && Option.isSome(to) && from.value <= to.value) {
    return StatsPeriod.Days({ from: from.value, to: to.value })
  }

  return Option.match(decodePreset(params.get(rangeParam)), {
    onNone: () => defaultStatsPeriod,
    onSome: preset => StatsPeriod.Preset({ preset })
  })
}

/** The query entries for a period; none for the default. */
type QueryEntry = readonly [string, string]

export const statsPeriodParams = (period: StatsPeriod): ReadonlyArray<QueryEntry> =>
  StatsPeriod.$match(period, {
    Preset: ({ preset }): ReadonlyArray<QueryEntry> =>
      preset === defaultStatsPreset ? [] : [[rangeParam, preset]],
    Days: ({ from, to }): ReadonlyArray<QueryEntry> => [
      [fromParam, from],
      [toParam, to]
    ]
  })
