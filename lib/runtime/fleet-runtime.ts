import { Effect, Layer, ManagedRuntime } from 'effect'
import { SessionSummaries, SessionSummariesLive } from '@/lib/data/fleet/session-detail'
import { FleetStore, FleetStoreLive } from '@/lib/data/fleet/store'
import { FleetWatcherLive } from '@/lib/data/fleet/watcher'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'
import type { OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import type { OpenCode } from '@/lib/services/opencode/service'

export type FleetServices = FleetStore | OpenCode | SessionSummaries

/**
 * Store + OpenCode client + finished-run summary cache, with the watcher forked for the lifetime
 * of the runtime.
 */
export const FleetLayer = Layer.merge(FleetWatcherLive(), SessionSummariesLive).pipe(
  Layer.provideMerge(FleetStoreLive),
  Layer.provideMerge(OpenCodeLive)
)

// Fails to build only on invalid configuration (e.g. a malformed OPENCODE_URL).
type FleetRuntime = ManagedRuntime.ManagedRuntime<FleetServices, OpenCodeUnavailableError>

// Next bundles `instrumentation.ts`, route handlers, and server actions separately, and dev
// reloads re-evaluate modules; the one runtime lives on `globalThis` so every bundle (and every
// reload) shares a single watcher.
const runtimeKey: unique symbol = Symbol.for('fleet.runtime')

const scope: typeof globalThis & { [runtimeKey]?: FleetRuntime } = globalThis

export const getFleetRuntime = (): FleetRuntime => {
  const existing = scope[runtimeKey]

  if (existing !== undefined) return existing

  const runtime = ManagedRuntime.make(FleetLayer)

  scope[runtimeKey] = runtime

  return runtime
}

/** Builds the runtime (which forks the watcher). Safe to call more than once. */
export const startFleet = (): Promise<void> =>
  getFleetRuntime()
    .runPromise(Effect.asVoid(FleetStore))
    .catch((error: Error) => {
      console.error('Fleet failed to start', error)
    })

export const runFleet = <A, E>(effect: Effect.Effect<A, E, FleetServices>): Promise<A> =>
  getFleetRuntime().runPromise(effect)
