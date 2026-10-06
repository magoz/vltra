import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import {
  calendarDayParts,
  defaultStatsPeriod,
  StatsPeriod,
  statsPeriodOf,
  statsPeriodParams
} from '@/lib/data/fleet/stats-period'

const query = (value: string) => new URLSearchParams(value)

describe('stats periods', () => {
  it('reads a preset, else days, else 7 days', () => {
    expect(statsPeriodOf(query(''))).toEqual(defaultStatsPeriod)
    expect(statsPeriodOf(query('range=30d'))).toEqual(StatsPeriod.Preset({ preset: '30d' }))
    expect(statsPeriodOf(query('range=1y'))).toEqual(defaultStatsPeriod)

    // Days win over a range.
    expect(statsPeriodOf(query('range=30d&from=2026-10-01&to=2026-10-03'))).toEqual(
      StatsPeriod.Days({ from: '2026-10-01', to: '2026-10-03' })
    )
  })

  it('falls back on days out of order, half given, or not real', () => {
    expect(statsPeriodOf(query('from=2026-10-03&to=2026-10-01'))).toEqual(defaultStatsPeriod)
    expect(statsPeriodOf(query('from=2026-10-03'))).toEqual(defaultStatsPeriod)
    expect(statsPeriodOf(query('from=2026-02-30&to=2026-03-01&range=24h'))).toEqual(
      StatsPeriod.Preset({ preset: '24h' })
    )
  })

  it('writes nothing for the default and round-trips the rest', () => {
    expect(statsPeriodParams(defaultStatsPeriod)).toEqual([])

    for (const period of [
      StatsPeriod.Preset({ preset: 'all' }),
      StatsPeriod.Days({ from: '2026-09-01', to: '2026-09-30' })
    ]) {
      const params = new URLSearchParams()

      for (const [name, value] of statsPeriodParams(period)) params.set(name, value)

      expect(statsPeriodOf(params)).toEqual(period)
    }
  })

  it('knows real days', () => {
    expect(calendarDayParts('2028-02-29')).toEqual(Option.some({ year: 2028, month: 2, day: 29 }))
    expect(calendarDayParts('2026-02-29')).toEqual(Option.none())
    expect(calendarDayParts('2026-1-01')).toEqual(Option.none())
  })
})
