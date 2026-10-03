'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import type { SessionSelection } from '@/app/fleet-context'
import { sessionParam } from '@/app/fleet-href'

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
 * phone's back button works on either page. Opening from a page pushes one history entry;
 * switching between sessions replaces it, so Back always returns to the page. Closing goes back
 * when Fleet pushed the entry on this page, and otherwise (a deep link, or a page switch since)
 * replaces the URL with the page.
 */
export function useSelectedSession(): SessionSelection {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const selected = searchParams.get(sessionParam) ?? undefined
  const pushed = useRef(false)

  useEffect(() => {
    pushed.current = false
  }, [pathname])

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
