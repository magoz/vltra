import { openCheckoutResponse } from '@/app/api/vltra/mutations'
import { runVltra } from '@/lib/runtime/vltra-runtime'

/**
 * Open a repository or worktree from the launcher: `{ directory }` → `{ sessionID, created }`, its
 * latest root session or a new empty one there.
 */
export async function POST(request: Request) {
  return await runVltra(openCheckoutResponse(request))
}
