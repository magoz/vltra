import { Effect, Layer, ManagedRuntime } from 'effect'
import { LaunchesLive } from '@/lib/data/fleet/launches'
import type { Launches } from '@/lib/data/fleet/launches'
import { SessionSummaries, SessionSummariesLive } from '@/lib/data/fleet/session-detail'
import { FleetStore, FleetStoreLive } from '@/lib/data/fleet/store'
import { FleetWatcherLive } from '@/lib/data/fleet/watcher'
import { DirectoriesLive } from '@/lib/services/directories/live-layer'
import type { Directories } from '@/lib/services/directories/service'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'
import type { OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import type { OpenCode } from '@/lib/services/opencode/service'
import { ReposLive } from '@/lib/services/repos/live-layer'
import type { Repos } from '@/lib/services/repos/service'
import { UsageLive } from '@/lib/services/usage/live-layer'
import type { Usage } from '@/lib/services/usage/service'

export type FleetServices =
  | FleetStore
  | OpenCode
  | SessionSummaries
  | Directories
  | Repos
  | Launches
  | Usage

/**
 * Store + OpenCode client + session folder checks + finished-run summary cache + the launcher's
 * repositories and launch registry + the subscription quotas, with the watcher (and any running launch) forked for the
 * lifetime of the runtime.
 */
export const FleetLayer = Layer.mergeAll(
  FleetWatcherLive(),
  SessionSummariesLive,
  LaunchesLive()
).pipe(
  Layer.provideMerge(FleetStoreLive),
  Layer.provideMerge(OpenCodeLive),
  Layer.provideMerge(DirectoriesLive),
  Layer.provideMerge(ReposLive),
  Layer.provideMerge(UsageLive)
)

// Fails to build only on invalid configuration (e.g. a malformed OPENCODE_URL).
type FleetRuntime = ManagedRuntime.ManagedRuntime<FleetServices, OpenCodeUnavailableError>

// Next bundles `instrumentation.ts`, route handlers, and server actions separately, and dev
// reloads re-evaluate modules; the one runtime lives on `globalThis` so every bundle (and every
// reload) shares a single watcher.
const runtimeKey: unique symbol = Symbol.for('fleet.runtime')

const stoppedKey: unique symbol = Symbol.for('fleet.stopped')

const scope: typeof globalThis & { [runtimeKey]?: FleetRuntime; [stoppedKey]?: true } = globalThis

export const getFleetRuntime = (): FleetRuntime => {
  // During shutdown, never build a second runtime (e.g. for an event stream reconnecting over a
  // kept-alive connection): the request fails and the browser reconnects to the next server.
  if (scope[stoppedKey] === true) throw new Error('Fleet is shutting down')

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

/**
 * Disposes the runtime: stops the watcher and closes the store, which ends every open
 * `GET /api/fleet/events` stream. Next's graceful shutdown (`server.close`) waits for open
 * connections, so without this a connected dashboard keeps `next start` alive after SIGTERM.
 */
export const stopFleet = async (): Promise<void> => {
  const runtime = scope[runtimeKey]

  scope[stoppedKey] = true

  if (runtime === undefined) return

  delete scope[runtimeKey]
  await runtime.dispose()
}

/**
 * Next's own SIGTERM/SIGINT handler closes the HTTP server and waits for open connections;
 * stopping Fleet ends the event streams so it can finish (otherwise `systemctl restart fleet`
 * waits for systemd's stop timeout while a dashboard is open).
 */
export const stopFleetOnSignals = () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      stopFleet().catch((error: Error) => console.error('Fleet failed to stop', error))
    })
  }
}

export const runFleet = <A, E>(effect: Effect.Effect<A, E, FleetServices>): Promise<A> =>
  getFleetRuntime().runPromise(effect)
