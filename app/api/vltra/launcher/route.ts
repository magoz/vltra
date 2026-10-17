import { Effect, Schema } from 'effect'
import { connection } from 'next/server'
import { loadLauncher } from '@/lib/data/vltra/launcher'
import { LauncherList } from '@/lib/data/vltra/types'
import { runVltra } from '@/lib/runtime/vltra-runtime'

const encodeList = Schema.encodeEffect(LauncherList)

/**
 * The launcher's list: git repositories on Box (the launcher roots and OpenCode's projects) with
 * their worktrees, owners, PR status and sessions, most recent agent activity first. Shared with
 * the terminal plugin, which decodes the same `LauncherList`.
 */
export async function GET() {
  // Reads the disk and the in-process watcher, so it runs per request.
  await connection()

  return await runVltra(
    loadLauncher.pipe(
      Effect.flatMap(encodeList),
      Effect.map(body => Response.json(body, { headers: { 'cache-control': 'no-store' } })),
      Effect.withSpan('api.vltra.launcher'),
      Effect.catchTag('SchemaError', error =>
        Effect.logError('api.vltra.launcher failed', error.message).pipe(
          Effect.as(Response.json({ error: 'Internal error' }, { status: 500 }))
        )
      )
    )
  )
}
