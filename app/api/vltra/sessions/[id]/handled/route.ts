import { markHandledResponse } from '@/app/api/vltra/mutations'
import { runVltra } from '@/lib/runtime/vltra-runtime'

type Context = { readonly params: Promise<{ readonly id: string }> }

/** Mark a finished root session's latest run handled (the terminal plugin's `h`). Body `{}`. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  return await runVltra(markHandledResponse(request, id))
}
