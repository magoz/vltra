// When a snooze ends, picked in the browser: tomorrow, next Monday or in a week at the wake time
// set in Settings, or a day and time of my own, in the browser's own zone. Pure; times are epoch
// milliseconds.

/** The time of day snoozes end, `HH:MM` (Settings; 09:00 unless changed). */
export type WakeTime = { readonly hours: number; readonly minutes: number }

export const defaultWakeTime: WakeTime = { hours: 9, minutes: 0 }

const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** `HH:MM` (or `H:MM`) as a time of day; anything else is no time. */
export const parseWakeTime = (value: string): WakeTime | undefined => {
  const match = clock.exec(value)

  return match === null ? undefined : { hours: Number(match[1]), minutes: Number(match[2]) }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The wake time as `HH:MM`. */
export const formatWakeTime = (time: WakeTime): string => `${pad(time.hours)}:${pad(time.minutes)}`

/** `days` days after `now`'s day, at `time`, local. */
const daysAhead = (now: number, days: number, time: WakeTime) => {
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
  { label: 'Tomorrow', until: daysAhead(now, 1, time) },
  { label: 'Monday', until: daysAhead(now, toMonday(now), time) },
  { label: 'In a week', until: daysAhead(now, 7, time) }
]

/** A picked day (local midnight, as the calendar gives it) at `time`, local. */
export const dayAt = (day: Date, time: WakeTime): number => {
  const date = new Date(day)

  date.setHours(time.hours, time.minutes, 0, 0)

  return date.getTime()
}

/** `now`'s day at local midnight: the first day the calendar offers. */
export const startOfDay = (now: number): Date => new Date(new Date(now).setHours(0, 0, 0, 0))

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
