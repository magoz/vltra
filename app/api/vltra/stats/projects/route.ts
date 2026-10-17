import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/vltra/stats/stats-request'
import { PromptsByProject } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * Prompts per bar by project for the Stats tab's Prompts chart (same range as `/api/vltra/stats`;
 * every project, whatever `?project=`). Its own route, so the rest of the tab never waits for it.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runVltra(
    statsResponse(
      request,
      'api.vltra.stats.projects',
      (stats, query) => stats.promptsByProject(query),
      PromptsByProject
    )
  )
}
