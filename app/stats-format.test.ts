import { describe, expect, it } from 'vitest'
import {
  bucketLabel,
  bucketTitle,
  calendarDay,
  compactNumber,
  durationText,
  percentText,
  changeText,
  rangeText
} from '@/app/stats-format'

/** Tue Oct 6 2026, 14:00 in Madrid. */
const at = Date.UTC(2026, 9, 6, 12)

describe('stats formatting', () => {
  it('formats numbers, durations and shares compactly', () => {
    expect(compactNumber(806)).toBe('806')
    expect(compactNumber(15_661)).toBe('15.7K')
    expect(compactNumber(4_395_466_665)).toBe('4.4B')
    expect(durationText(45)).toBe('45ms')
    expect(durationText(1234)).toBe('1.2s')
    expect(durationText(90_000)).toBe('2m')
    expect(durationText(9_000_000)).toBe('2.5h')
    expect(durationText(3 * 86_400_000)).toBe('3d')
    expect(changeText(12.4)).toBe('+12%')
    expect(changeText(-8)).toBe('−8%')
    expect(changeText(0.2)).toBe('±0%')
    expect(changeText(2333)).toBe('24.3×')
    expect(percentText(1, 3)).toBe('33%')
    expect(percentText(1, 1000)).toBe('<1%')
    expect(percentText(0, 0)).toBe('0%')
  })

  it('labels buckets in the report time zone', () => {
    expect(bucketLabel(at, 'hour', 'Europe/Madrid')).toBe('14:00')
    expect(bucketLabel(at + 9 * 60_000, 'hour', 'Europe/Madrid')).toBe('14:00')
    expect(bucketLabel(at, 'day', 'Europe/Madrid')).toBe('Tue 6')
    expect(bucketLabel(at, 'week', 'Europe/Madrid')).toBe('Oct 6')
    expect(bucketTitle(at, 'hour', 'Europe/Madrid')).toBe('Tue, Oct 6, 14:00')
    expect(bucketTitle(at, 'week', 'Europe/Madrid')).toBe('week of Tue, Oct 6')
    // 23:30 UTC is already the next day in Madrid.
    expect(calendarDay(Date.UTC(2026, 9, 6, 23, 30), 'Europe/Madrid')).toBe('2026-10-07')
    expect(calendarDay(Date.UTC(2026, 9, 6, 23, 30), 'UTC')).toBe('2026-10-06')
  })

  it('names a range by its first and last day', () => {
    expect(rangeText(Date.UTC(2026, 8, 29, 22), at, 'Europe/Madrid')).toBe('Sep 30 – Oct 6')
    // The end is exclusive: midnight closes the day before.
    expect(rangeText(Date.UTC(2026, 9, 5, 22), Date.UTC(2026, 9, 6, 22), 'Europe/Madrid')).toBe(
      'Oct 6'
    )
  })
})
