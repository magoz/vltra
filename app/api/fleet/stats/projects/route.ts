import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/fleet/stats/stats-request'
import { PromptsByProject } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Prompts per bar by project for the Stats tab's Prompts chart (same range as `/api/fleet/stats`;
 * every project, whatever `?project=`). Its own route, so the rest of the tab never waits for it.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runFleet(
    statsResponse(
      request,
      'api.fleet.stats.projects',
      (stats, query) => stats.promptsByProject(query),
      PromptsByProject
    )
  )
}
