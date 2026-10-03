import { reopenResponse } from '@/app/api/fleet/mutations'
import { runFleet } from '@/lib/runtime/fleet-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/** Reopen a handled session: remove Fleet's handled marker (the terminal plugin's `u`). Body `{}`. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  return await runFleet(reopenResponse(request, id))
}
