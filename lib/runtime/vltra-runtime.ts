import { Effect, Layer, ManagedRuntime } from 'effect'
import { GitHubStatsLive } from '@/lib/data/vltra/github-stats'
import type { GitHubStats } from '@/lib/data/vltra/github-stats'
import { LaunchesLive } from '@/lib/data/vltra/launches'
import type { Launches } from '@/lib/data/vltra/launches'
import { NotifierLive } from '@/lib/data/vltra/notifier'
import { SessionSummaries, SessionSummariesLive } from '@/lib/data/vltra/session-detail'
import { StatsLive } from '@/lib/data/vltra/stats'
import type { Stats } from '@/lib/data/vltra/stats'
import { VltraStore, VltraStoreLive } from '@/lib/data/vltra/store'
import { VltraWatcherLive } from '@/lib/data/vltra/watcher'
import { exitOnSignals } from '@/lib/runtime/shutdown'
import { DirectoriesLive } from '@/lib/services/directories/live-layer'
import type { Directories } from '@/lib/services/directories/service'
import { GitHubLive } from '@/lib/services/github/live-layer'
import type { GitHub } from '@/lib/services/github/service'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'
import type { OpenCodeUnavailableError } from '@/lib/services/opencode/errors'
import type { OpenCode } from '@/lib/services/opencode/service'
import { PushLive } from '@/lib/services/push/live-layer'
import type { Push } from '@/lib/services/push/service'
import { ReposLive } from '@/lib/services/repos/live-layer'
import type { Repos } from '@/lib/services/repos/service'
import { UsageLive } from '@/lib/services/usage/live-layer'
import type { Usage } from '@/lib/services/usage/service'

export type VltraServices =
  | VltraStore
  | OpenCode
  | SessionSummaries
  | Stats
  | GitHubStats
  | Directories
  | Repos
  | Launches
  | Usage
  | GitHub
  | Push

/**
 * Store + OpenCode client + session folder checks + finished-run summary and stats caches (GitHub's
 * merged pull requests too) + the launcher's repositories and launch registry + the subscription
 * quotas + Web Push, with the watcher, the notifier (and any running launch) forked for the
 * lifetime of the runtime.
 */
export const VltraLayer = Layer.mergeAll(
  VltraWatcherLive(),
  NotifierLive,
  SessionSummariesLive,
  StatsLive,
  GitHubStatsLive,
  LaunchesLive()
).pipe(
  Layer.provideMerge(VltraStoreLive),
  Layer.provideMerge(PushLive),
  Layer.provideMerge(OpenCodeLive),
  Layer.provideMerge(DirectoriesLive),
  Layer.provideMerge(ReposLive),
  Layer.provideMerge(UsageLive),
  Layer.provideMerge(GitHubLive)
)

// Fails to build only on invalid configuration (e.g. a malformed OPENCODE_URL).
type VltraRuntime = ManagedRuntime.ManagedRuntime<VltraServices, OpenCodeUnavailableError>

// Next bundles `instrumentation.ts`, route handlers, and server actions separately, and dev
// reloads re-evaluate modules; the one runtime lives on `globalThis` so every bundle (and every
// reload) shares a single watcher.
const runtimeKey: unique symbol = Symbol.for('vltra.runtime')

const stoppedKey: unique symbol = Symbol.for('vltra.stopped')

const scope: typeof globalThis & { [runtimeKey]?: VltraRuntime; [stoppedKey]?: true } = globalThis

export const getVltraRuntime = (): VltraRuntime => {
  // During shutdown, never build a second runtime (e.g. for an event stream reconnecting over a
  // kept-alive connection): the request fails and the browser reconnects to the next server.
  if (scope[stoppedKey] === true) throw new Error('Vltra is shutting down')

  const existing = scope[runtimeKey]

  if (existing !== undefined) return existing

  const runtime = ManagedRuntime.make(VltraLayer)

  scope[runtimeKey] = runtime

  return runtime
}

/** Builds the runtime (which forks the watcher). Safe to call more than once. */
export const startVltra = (): Promise<void> =>
  getVltraRuntime()
    .runPromise(Effect.asVoid(VltraStore))
    .catch((error: Error) => {
      console.error('Vltra failed to start', error)
    })

/**
 * Disposes the runtime: stops the watcher and closes the store, which ends every open
 * `GET /api/vltra/events` stream. Next's graceful shutdown (`server.close`) waits for open
 * connections, so without this a connected dashboard keeps `next start` alive after SIGTERM.
 */
export const stopVltra = async (): Promise<void> => {
  const runtime = scope[runtimeKey]

  scope[stoppedKey] = true

  if (runtime === undefined) return

  delete scope[runtimeKey]
  await runtime.dispose()
}

/**
 * Next's own SIGTERM/SIGINT handler closes the HTTP server and waits for open connections;
 * stopping Vltra ends its event streams, and the deadline (`exitOnSignals`) ends the proxied
 * OpenCode connections nothing else closes, so `systemctl restart vltra` takes seconds.
 */
export const stopVltraOnSignals = () =>
  exitOnSignals({
    on: (signal, listener) => process.once(signal, listener),
    stop: stopVltra,
    after: (ms, exit) => setTimeout(exit, ms).unref(),
    exit: code => process.exit(code)
  })

export const runVltra = <A, E>(effect: Effect.Effect<A, E, VltraServices>): Promise<A> =>
  getVltraRuntime().runPromise(effect)
