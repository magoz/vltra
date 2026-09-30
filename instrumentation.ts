// Starts the one long-lived OpenCode watcher when the Next server boots (`next start` on Box, or
// `next dev`). The runtime lives on `globalThis`, so dev reloads reuse it instead of starting a
// second watcher. See patterns/LONG_LIVED_WATCHER.md.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { startFleet } = await import('@/lib/runtime/fleet-runtime')

  // Not awaited: `register` must finish before the server accepts requests, and the watcher
  // reconnects with backoff on its own.
  void startFleet()
}
