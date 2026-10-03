import { launchResponse } from '@/app/api/fleet/mutations'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Start a new worktree + session for a task: `{ repoDir, branch, task }` → `{ launchID }` at once;
 * the launch's progress arrives in the snapshot's and the event stream's `launches`.
 */
export async function POST(request: Request) {
  return await runFleet(launchResponse(request))
}
