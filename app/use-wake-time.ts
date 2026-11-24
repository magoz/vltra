'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { defaultWakeTime, formatWakeTime, parseWakeTime } from '@/app/snooze-time'
import type { WakeTime } from '@/app/snooze-time'

// The time of day snoozes end (Settings), kept in this browser: it only shapes the times the
// snooze menu offers, which the server stores as plain instants.

const key = 'vltra.snooze.wakeTime'

const changed = 'vltra:wake-time'

const subscribe = (notify: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) notify()
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(changed, notify)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(changed, notify)
  }
}

const read = () => {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

/** The wake time and a setter; the default (09:00) until one is saved, and while rendering on the server. */
export function useWakeTime(): readonly [WakeTime, (time: WakeTime) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => '')
  const time = parseWakeTime(stored) ?? defaultWakeTime

  const save = useCallback((next: WakeTime) => {
    try {
      window.localStorage.setItem(key, formatWakeTime(next))
    } catch {
      // Storage refused (private mode): the default stays.
    }

    window.dispatchEvent(new Event(changed))
  }, [])

  return [time, save]
}
