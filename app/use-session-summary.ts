'use client'

import { Option, Schema } from 'effect'
import { useEffect, useState } from 'react'
import { SessionSummary } from '@/lib/data/fleet/types'

const decodeSummary = Schema.decodeUnknownOption(Schema.fromJsonString(SessionSummary))

/**
 * A finished run's answer excerpt and change totals (`GET /api/fleet/sessions/:id/summary`).
 * Keyed by the run's `idle` time, so it is fetched once per run; undefined while loading or
 * when OpenCode could not provide it (the row simply shows less).
 */
export function useSessionSummary(sessionID: string, idle: number | undefined) {
  const [summary, setSummary] = useState<SessionSummary>()

  useEffect(() => {
    if (idle === undefined) return

    const controller = new AbortController()
    const params = new URLSearchParams({ idle: String(idle) })

    fetch(`/api/fleet/sessions/${encodeURIComponent(sessionID)}/summary?${params.toString()}`, {
      signal: controller.signal
    })
      .then(async response => (response.ok ? decodeSummary(await response.text()) : Option.none()))
      .then(decoded => {
        if (Option.isSome(decoded)) setSummary(decoded.value)
      })
      .catch(() => {
        // Aborted or unreachable: the row keeps its minimal form.
      })

    return () => controller.abort()
  }, [sessionID, idle])

  return summary?.sessionID === sessionID && summary.idle === idle ? summary : undefined
}
