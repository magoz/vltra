import { openCheckoutResponse } from '@/app/api/fleet/mutations'
import { runFleet } from '@/lib/runtime/fleet-runtime'

/**
 * Open a repository or worktree from the launcher: `{ directory }` → `{ sessionID, created }`, its
 * latest root session or a new empty one there.
 */
export async function POST(request: Request) {
  return await runFleet(openCheckoutResponse(request))
}
