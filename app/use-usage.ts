'use client'

import { Option, Schema } from 'effect'
import { useEffect, useState } from 'react'
import { UsageSummary } from '@/lib/data/vltra/types'

const decodeSummary = Schema.decodeUnknownOption(Schema.fromJsonString(UsageSummary))

/** The usage dashboard re-reads providers every 5-10 minutes; once a minute keeps up. */
const refreshEvery = 60_000

/**
 * The subscription quotas (`GET /api/vltra/usage`): loaded on mount, every minute while the page
 * shows, and when it shows again. A failed load keeps the last summary.
 */
export function useUsage(): UsageSummary | undefined {
  const [summary, setSummary] = useState<UsageSummary>()

  useEffect(() => {
    let disposed = false

    const load = () => {
      if (document.visibilityState !== 'visible') return

      fetch('/api/vltra/usage', { cache: 'no-store' })
        .then(response => (response.ok ? response.text() : undefined))
        .then(text => {
          const decoded = text === undefined ? Option.none() : decodeSummary(text)

          if (!disposed && Option.isSome(decoded)) setSummary(decoded.value)
        })
        .catch(() => {
          // Vltra unreachable: keep the last summary; the next tick tries again.
        })
    }

    load()

    const timer = setInterval(load, refreshEvery)

    document.addEventListener('visibilitychange', load)

    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  return summary
}
