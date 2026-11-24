import { describe, expect, it } from 'vitest'
import {
  dayAt,
  defaultWakeTime,
  formatWakeTime,
  parseWakeTime,
  snoozePresets,
  startOfDay,
  wakeText
} from '@/app/snooze-time'

// Local dates (`new Date(y, m, d, h, min)`), so these hold in any time zone.
const local = (month: number, day: number, hours = 0, minutes = 0) =>
  new Date(2026, month - 1, day, hours, minutes).getTime()

/** Tuesday 24 November 2026, 15:30. */
const tuesday = local(11, 24, 15, 30)

describe('wake time', () => {
  it('reads and writes HH:MM, nothing else', () => {
    expect(parseWakeTime('09:00')).toEqual({ hours: 9, minutes: 0 })
    expect(parseWakeTime('23:59')).toEqual({ hours: 23, minutes: 59 })
    expect(parseWakeTime('24:00')).toBeUndefined()
    expect(parseWakeTime('9:30')).toEqual({ hours: 9, minutes: 30 })
    expect(parseWakeTime('9:3')).toBeUndefined()
    expect(parseWakeTime('')).toBeUndefined()
    expect(formatWakeTime(defaultWakeTime)).toBe('09:00')
    expect(formatWakeTime({ hours: 7, minutes: 5 })).toBe('07:05')
  })
})

describe('snooze presets', () => {
  it('tomorrow, next Monday and a week from today, at the wake time', () => {
    expect(snoozePresets(tuesday, defaultWakeTime)).toEqual([
      { label: 'Tomorrow', until: local(11, 25, 9) },
      { label: 'Monday', until: local(11, 30, 9) },
      { label: 'In a week', until: local(12, 1, 9) }
    ])
  })

  it('on a Monday, Monday is the next one; on a Sunday, tomorrow', () => {
    const monday = local(11, 30, 10)
    const sunday = local(11, 29, 22)

    expect(snoozePresets(monday, defaultWakeTime)[1]?.until).toBe(local(12, 7, 9))
    expect(snoozePresets(sunday, defaultWakeTime)[1]?.until).toBe(local(11, 30, 9))
  })

  it('follow the wake time set in Settings', () => {
    expect(snoozePresets(tuesday, { hours: 7, minutes: 30 })[0]?.until).toBe(local(11, 25, 7, 30))
  })
})

describe('picked day and time', () => {
  it('is that day at that time, local', () => {
    const december3 = new Date(2026, 11, 3)

    expect(dayAt(december3, defaultWakeTime)).toBe(local(12, 3, 9))
    expect(dayAt(december3, { hours: 18, minutes: 45 })).toBe(local(12, 3, 18, 45))
  })

  it("starts the calendar at today's midnight", () => {
    expect(startOfDay(tuesday).getTime()).toBe(local(11, 24))
  })
})

describe('wakeText', () => {
  it('says when a snooze ends: tomorrow, a weekday within the week, a date beyond', () => {
    expect(wakeText(local(11, 24, 18), tuesday)).toBe('18:00')
    expect(wakeText(local(11, 25, 9), tuesday)).toBe('tomorrow 9:00')
    expect(wakeText(local(11, 30, 9), tuesday)).toBe('Mon 9:00')
    expect(wakeText(local(12, 1, 9), tuesday)).toBe('Dec 1 9:00')
    expect(wakeText(local(12, 3, 7, 5), tuesday)).toBe('Dec 3 7:05')
  })
})
