import { readFile } from 'node:fs/promises'
import path from 'node:path'

// The build this server started with (`next build` writes `.next/BUILD_ID`), so an open page can
// tell when a deploy replaced it. Read once at boot and kept on `globalThis`, like the runtime
// (every Next bundle shares it): `pnpm ship` rewrites the file while the old server still runs.

const buildKey: unique symbol = Symbol.for('fleet.buildId')

const scope: typeof globalThis & { [buildKey]?: Promise<string> } = globalThis

/** `development` when there is no build (`next dev`): never a mismatch. */
const readBuildId = () =>
  readFile(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').then(
    text => text.trim(),
    () => 'development'
  )

/** This server's build id, read on first use (at boot, from `instrumentation.ts`). */
export const buildId = (): Promise<string> => {
  scope[buildKey] ??= readBuildId()

  return scope[buildKey]
}
