import { Effect } from 'effect'
import { connection } from 'next/server'
import type { NextRequest } from 'next/server'
import { statsResponse } from '@/app/api/vltra/stats/stats-request'
import { GitHubStats } from '@/lib/data/vltra/github-stats'
import { MergedPulls } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * The user's pull requests merged in the range, any repository (same range as `/api/vltra/stats`;
 * `?project=` ignored), through the host's `gh`. Its own route, so the rest of the tab never waits
 * for GitHub; `503` when `gh` is missing or signed out.
 */
export async function GET(request: NextRequest) {
  await connection()

  return await runVltra(
    statsResponse(
      request,
      'api.vltra.stats.github',
      query => Effect.flatMap(GitHubStats, github => github.merged(query)),
      MergedPulls
    )
  )
}
