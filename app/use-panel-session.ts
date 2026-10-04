'use client'

import { useEffect, useState } from 'react'

/**
 * The session the panel shows: the selection, except that a switch from one session to another
 * lands after the next paint. The OpenCode iframe is same-site, so it runs on Fleet's main thread:
 * swapping it in the same commit (tearing one OpenCode app down, starting the next) would hold the
 * list's new selection off screen. Opening and closing apply at once. (Not `useDeferredValue`: the
 * selection changes inside Next's router transition, where it defers nothing.)
 */
export function usePanelSession(selected: string | undefined): string | undefined {
  const [shown, setShown] = useState(selected)

  useEffect(() => {
    if (shown === selected) return

    let timeout: ReturnType<typeof setTimeout> | undefined

    // A frame callback runs just before the paint; a timeout queued from it runs after.
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => setShown(selected), 0)
    })

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
    }
  }, [selected, shown])

  return selected === undefined || shown === undefined ? selected : shown
}
