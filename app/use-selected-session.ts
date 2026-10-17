'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import type { SessionSelection } from '@/app/vltra-context'
import { sessionParam, viewParam } from '@/app/vltra-href'

/** The current URL with `?session=` set to `sessionID`, or removed; other params kept. */
const withSession = (sessionID: string | undefined) => {
  const params = new URLSearchParams(window.location.search)

  if (sessionID === undefined) params.delete(sessionParam)
  else params.set(sessionParam, sessionID)

  const query = params.toString()

  return query === '' ? window.location.pathname : `${window.location.pathname}?${query}`
}

/**
 * The selected session and how to change it; it lives in the URL (`?session=<id>`), so the
 * phone's back button works on every tab. Opening from a tab pushes one history entry; switching
 * between sessions replaces it, so Back always returns to the tab. Closing goes back when Vltra
 * pushed the entry on this tab, and otherwise (a deep link, or a tab switch since) replaces the
 * URL with the tab.
 */
export function useSelectedSession(): SessionSelection {
  const searchParams = useSearchParams()
  const selected = searchParams.get(sessionParam) ?? undefined
  const view = searchParams.get(viewParam)
  const pushed = useRef(false)

  useEffect(() => {
    pushed.current = false
  }, [view])

  const select = useCallback(
    (sessionID: string) => {
      if (sessionID === selected) return

      if (selected === undefined) {
        window.history.pushState(null, '', withSession(sessionID))
        pushed.current = true
      } else {
        window.history.replaceState(null, '', withSession(sessionID))
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

    window.history.replaceState(null, '', withSession(undefined))
  }, [])

  return { selected, select, close }
}
