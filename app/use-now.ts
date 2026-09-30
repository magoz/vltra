'use client'

import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every `interval` ms for relative times and the idle window. Starts
 * from `initial` (the server's snapshot time) so server and client render the same text.
 */
export function useNow(initial: number, interval = 30_000) {
  const [now, setNow] = useState(initial)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, interval)

    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [interval])

  return now
}
