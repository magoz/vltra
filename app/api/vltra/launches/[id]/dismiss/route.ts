import { dismissLaunchResponse } from '@/app/api/vltra/mutations'
import { runVltra } from '@/lib/runtime/vltra-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/** Remove a failed (or ready) launch from the list. Body `{}`. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  return await runVltra(dismissLaunchResponse(request, id))
}
