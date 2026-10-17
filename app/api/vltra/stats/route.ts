import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/vltra/stats/stats-request'
import { StatsReport } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * The Stats tab's numbers: OpenCode's stats for `?range=` (`24h`, `7d`, `30d`, `90d`, `all`) or
 * `?from=&to=` (days), in `?tz=` (the browser's zone), optionally for one OpenCode `?project=`.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runVltra(
    statsResponse(request, 'api.vltra.stats', (stats, query) => stats.report(query), StatsReport)
  )
}
