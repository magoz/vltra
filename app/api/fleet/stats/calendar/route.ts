import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/fleet/stats/stats-request'
import { StatsCalendar } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Steps per day over the last 53 weeks for the Stats tab's year calendar (`?tz=`, `?project=`;
 * the range is ignored). Its own route, so the rest of the tab never waits for it.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runFleet(
    statsResponse(
      request,
      'api.fleet.stats.calendar',
      (stats, query) => stats.calendar(query),
      StatsCalendar
    )
  )
}
