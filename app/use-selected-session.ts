'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useRef } from 'react'

/** The open session panel lives in the URL (`?session=<id>`), so the phone's back button works. */
export const sessionParam = 'session'

export const sessionHref = (sessionID: string) =>
  `?${new URLSearchParams({ [sessionParam]: sessionID }).toString()}`

/**
 * The selected session and how to change it. Opening from the list pushes one history entry;
 * switching between sessions replaces it, so Back always returns to the list. Closing goes back
 * when Fleet pushed the entry, and otherwise (a deep link) replaces the URL with the list.
 */
export function useSelectedSession() {
  const searchParams = useSearchParams()
  const selected = searchParams.get(sessionParam) ?? undefined
  const pushed = useRef(false)

  const select = useCallback(
    (sessionID: string) => {
      if (sessionID === selected) return

      if (selected === undefined) {
        window.history.pushState(null, '', sessionHref(sessionID))
        pushed.current = true
      } else {
        window.history.replaceState(null, '', sessionHref(sessionID))
      }
    },
    [selected]
  )

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false
      window.history.back()

      return
    }

    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  return { selected, select, close }
}
