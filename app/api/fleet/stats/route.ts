import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/fleet/stats/stats-request'
import { StatsReport } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * The Stats tab's numbers: OpenCode's stats for `?range=` (`24h`, `7d`, `30d`, `90d`, `all`) or
 * `?from=&to=` (days), in `?tz=` (the browser's zone), optionally for one OpenCode `?project=`.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runFleet(
    statsResponse(request, 'api.fleet.stats', (stats, query) => stats.report(query), StatsReport)
  )
}
