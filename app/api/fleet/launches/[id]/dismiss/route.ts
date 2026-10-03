import { dismissLaunchResponse } from '@/app/api/fleet/mutations'
import { runFleet } from '@/lib/runtime/fleet-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/** Remove a failed (or ready) launch from the list. Body `{}`. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  return await runFleet(dismissLaunchResponse(request, id))
}
