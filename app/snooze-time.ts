// When a snooze ends, picked in the browser: a day (tomorrow, next Monday, in a week, or a date)
// at the wake time set in Settings, in the browser's own zone. Pure; times are epoch milliseconds.

/** The time of day snoozes end, `HH:MM` (Settings; 09:00 unless changed). */
export type WakeTime = { readonly hours: number; readonly minutes: number }

export const defaultWakeTime: WakeTime = { hours: 9, minutes: 0 }

const clock = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `HH:MM` (an `<input type="time">` value) as a wake time; anything else is no time. */
export const parseWakeTime = (value: string): WakeTime | undefined => {
  const match = clock.exec(value)

  return match === null ? undefined : { hours: Number(match[1]), minutes: Number(match[2]) }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The wake time as `HH:MM`. */
export const formatWakeTime = (time: WakeTime): string => `${pad(time.hours)}:${pad(time.minutes)}`

/** `days` days after `now`'s day, at `time`, local. */
const dayAt = (now: number, days: number, time: WakeTime) => {
  const date = new Date(now)

  date.setDate(date.getDate() + days)
  date.setHours(time.hours, time.minutes, 0, 0)

  return date.getTime()
}

/** Days from `now`'s day to the next Monday (a week on a Monday). */
const toMonday = (now: number) => {
  const weekday = new Date(now).getDay()

  return weekday === 1 ? 7 : (8 - weekday) % 7
}

export type SnoozePreset = { readonly label: string; readonly until: number }

/** The menu's choices as of `now`: tomorrow, next Monday, a week from today, each at `time`. */
export const snoozePresets = (now: number, time: WakeTime): ReadonlyArray<SnoozePreset> => [
  { label: 'Tomorrow', until: dayAt(now, 1, time) },
  { label: 'Monday', until: dayAt(now, toMonday(now), time) },
  { label: 'In a week', until: dayAt(now, 7, time) }
]

const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/

/** A picked day (`YYYY-MM-DD`, an `<input type="date">` value) at `time`, local. */
export const dayToUntil = (day: string, time: WakeTime): number | undefined => {
  const match = isoDay.exec(day)

  if (match === null) return undefined

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))

  date.setHours(time.hours, time.minutes, 0, 0)

  return Number.isNaN(date.getTime()) ? undefined : date.getTime()
}

/** `now`'s next day as `YYYY-MM-DD`: the earliest a date picker offers. */
export const tomorrowDay = (now: number): string => {
  const date = new Date(dayAt(now, 1, defaultWakeTime))

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0)

/**
 * When a snooze ends, short: `tomorrow 9:00`, `Thu 9:00` within the week ahead, `Dec 3 9:00`
 * beyond; `9:00` if it is still today.
 */
export const wakeText = (until: number, now: number): string => {
  const date = new Date(until)
  const time = `${date.getHours()}:${pad(date.getMinutes())}`
  const days = Math.round((midnight(until) - midnight(now)) / (24 * 60 * 60 * 1000))

  if (days <= 0) return time

  if (days === 1) return `tomorrow ${time}`

  if (days < 7) return `${weekdays[date.getDay()] ?? ''} ${time}`

  return `${months[date.getMonth()] ?? ''} ${date.getDate()} ${time}`
}
