import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/vltra/stats/stats-request'
import { StatsHours } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * Prompts per hour for the Stats tab's time-of-day charts (same query as `/api/vltra/stats`), or
 * `TooLong` past 31 days. Its own route, so the rest of the tab never waits for it.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runVltra(
    statsResponse(
      request,
      'api.vltra.stats.hours',
      (stats, query) => stats.hours(query),
      StatsHours
    )
  )
}
