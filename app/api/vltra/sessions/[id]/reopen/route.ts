import { reopenResponse } from '@/app/api/vltra/mutations'
import { runVltra } from '@/lib/runtime/vltra-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/** Reopen a handled session: remove Vltra's handled marker (the terminal plugin's `u`). Body `{}`. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  return await runVltra(reopenResponse(request, id))
}
