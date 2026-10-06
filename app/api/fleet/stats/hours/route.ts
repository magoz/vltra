import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/fleet/stats/stats-request'
import { StatsHours } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Prompts per hour for the Stats tab's time-of-day charts (same query as `/api/fleet/stats`), or
 * `TooLong` past 31 days. Its own route, so the rest of the tab never waits for it.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runFleet(
    statsResponse(
      request,
      'api.fleet.stats.hours',
      (stats, query) => stats.hours(query),
      StatsHours
    )
  )
}
