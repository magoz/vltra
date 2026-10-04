import { connection } from 'next/server'
import { buildId } from '@/lib/runtime/build-id'

/** The build this server runs (`{ build }`): an open page reloads when it is not its own. */
export async function GET() {
  await connection()

  return Response.json({ build: await buildId() }, { headers: { 'cache-control': 'no-store' } })
}
