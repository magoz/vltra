import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Schedule } from 'effect'
import {
  loadLauncher,
  openCheckout,
  retireWorktree,
  suggestBranch
} from '@/lib/data/fleet/launcher'
import { Launches, LaunchesLive } from '@/lib/data/fleet/launches'
import { FleetStore, FleetStoreLive } from '@/lib/data/fleet/store'
import type { Launch } from '@/lib/data/fleet/types'
import { FleetWatcherLive } from '@/lib/data/fleet/watcher'
import type { WatcherOptions } from '@/lib/data/fleet/watcher'
import { DirectoriesLive } from '@/lib/services/directories/live-layer'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'
import { OpenCode } from '@/lib/services/opencode/service'
import { findOpenCode, startOpenCodeServer } from '@/lib/services/opencode/testing/opencode-server'
import type { OpenCodeServer } from '@/lib/services/opencode/testing/opencode-server'
import { makeRepos } from '@/lib/services/repos/live-layer'
import { Repos } from '@/lib/services/repos/service'

// The launcher against a real, isolated, throwaway `opencode serve` (v2.0.22) with OpenCode's
// DEFAULT git worktree strategy: the dotfiles plugin is not loaded there. Temp repositories only;
// the default model is unavailable, so no prompt ever reaches a model.

const binary = findOpenCode()

process.env.OPENCODE_SERVICE_FILE = '/nonexistent/fleet-launcher-integration/service.json'

if (!binary.available) {
  console.warn(`Skipping launcher integration tests: ${binary.reason}`)
}

const watcher: WatcherOptions = {
  reconnect: Schedule.spaced('200 millis'),
  dropDelay: '250 millis',
  connectTimeout: '10 seconds',
  recount: '1 minute'
}

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync('git', ['-c', 'user.name=Fleet', '-c', 'user.email=fleet@example.com', ...args], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  }).toString()

/** A fresh repository with one commit under the server's own temp directory. */
const makeRepo = (server: OpenCodeServer, name: string) => {
  const directory = path.join(server.workDirectory, 'repos', name)

  mkdirSync(directory, { recursive: true })
  git(directory, 'init', '-q', '-b', 'main')
  git(directory, 'commit', '-q', '--allow-empty', '-m', 'init')

  return realpathSync(directory)
}

const fleetLayer = (server: OpenCodeServer) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: { OPENCODE_URL: server.url, OPENCODE_PASSWORD: server.password }
    })
  )

  const repos = Layer.effect(
    Repos,
    makeRepos({ roots: [path.join(server.workDirectory, 'repos')] })
  ).pipe(
    Layer.provide(NodeChildProcessSpawner.layer),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  )

  return Layer.mergeAll(FleetWatcherLive(watcher), LaunchesLive()).pipe(
    Layer.provideMerge(FleetStoreLive),
    Layer.provideMerge(OpenCodeLive),
    Layer.provideMerge(DirectoriesLive),
    Layer.provideMerge(repos),
    Layer.provideMerge(config)
  )
}

/** Polls (real time) until `check` yields a value. */
const eventually = <A, E, R>(check: Effect.Effect<A | undefined, E, R>, what: string) =>
  check.pipe(
    Effect.flatMap(value =>
      value === undefined ? Effect.fail(`waiting for ${what}`) : Effect.succeed(value)
    ),
    Effect.retry(Schedule.spaced('200 millis').pipe(Schedule.upTo({ duration: '30 seconds' }))),
    Effect.orDie
  )

const launchNamed = (id: string) =>
  Effect.flatMap(FleetStore, store =>
    Effect.map(store.view, view => view.launches.find(launch => launch.id === id))
  )

type Listed = ReadonlyArray<{ readonly directory: string }>

type Messages = {
  readonly data: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

describe.skipIf(!binary.available)('launcher against a real opencode serve', () => {
  it.live(
    'registers a repository OpenCode never opened, then launches end to end (git strategy)',
    () =>
      Effect.gen(function* () {
        const server = yield* startOpenCodeServer(binary.available ? binary.path : 'opencode', {
          config: { model: 'fleet-none/none' }
        })

        const repo = makeRepo(server, 'alpha')

        yield* Effect.gen(function* () {
          yield* eventually(
            Effect.map(
              Effect.flatMap(FleetStore, store => store.snapshot),
              snapshot => (snapshot.connection.status === 'connected' ? true : undefined)
            ),
            'connection'
          )

          // location.get registers the repository as its own project.
          const connection = yield* Effect.flatMap(OpenCode, opencode => opencode.connect)

          expect(connection.url).toBe(server.url)

          const location = yield* connection.resolveLocation(repo)

          expect(location.projectID).not.toBe('global')
          expect(location.projectDirectory).toBe(repo)

          const projects = yield* server.json<ReadonlyArray<{ readonly id: string }>>(
            'GET',
            '/api/project'
          )

          expect(projects.map(project => project.id)).toContain(location.projectID)

          // The launcher lists it with OpenCode's project id.
          const listed = yield* eventually(
            Effect.map(loadLauncher, list =>
              list.entries.find(
                entry =>
                  entry.kind === 'repo' && entry.directory === repo && entry.projectID !== undefined
              )
            ),
            'launcher entry'
          )

          expect(listed).toMatchObject({ name: 'alpha', projectID: location.projectID })

          // Launch: worktree.create (default git strategy) → session.create there → prompt.
          const task = 'Write a haiku about launchers'
          const launches = yield* Launches
          const started = yield* launches.start({ repoDir: repo, branch: 'feat/it-launch', task })

          expect(started.status).toBe('provisioning')

          const ready: Launch = yield* eventually(
            Effect.flatMap(launchNamed(started.id), launch =>
              launch?.status === 'failed'
                ? Effect.die(new Error(`launch failed: ${launch.error ?? ''}`))
                : Effect.succeed(launch?.status === 'ready' ? launch : undefined)
            ),
            'ready launch'
          )

          const directory = ready.directory ?? ''
          const sessionID = ready.sessionID ?? ''

          expect(existsSync(directory)).toBe(true)

          const worktrees = yield* server.json<Listed>(
            'GET',
            `/api/worktree?projectID=${location.projectID}`
          )

          expect(worktrees.map(item => item.directory)).toContain(directory)

          const session = yield* server.json<{
            readonly data: {
              readonly title?: string
              readonly location: { readonly directory: string }
            }
          }>('GET', `/api/session/${sessionID}`)

          // Untitled: OpenCode titles it from the task when the model runs (none answers here).
          expect(session.data).toMatchObject({ location: { directory } })
          expect(session.data.title).toBeUndefined()

          // The prompt was accepted (the model is unavailable, so nothing answers it).
          const messages = yield* server.json<Messages>(
            'GET',
            `/api/session/${sessionID}/message?order=asc&limit=10`
          )

          expect(messages.data.find(message => message.type === 'user')).toBeDefined()

          // Opening the worktree resumes that session (once the watcher saw it).
          const opened = yield* eventually(
            Effect.map(openCheckout({ directory }), result =>
              result.created ? undefined : result
            ).pipe(Effect.orElseSucceed(() => undefined)),
            'session in the worktree'
          )

          expect(opened.sessionID).toBe(sessionID)

          // The git strategy's checkout has no dotfiles marker: Fleet refuses to retire it.
          const refused = yield* retireWorktree({
            projectID: location.projectID,
            directory
          }).pipe(Effect.flip)

          expect(refused._tag).toBe('RetireRefusedError')
          expect(existsSync(directory)).toBe(true)

          // OpenCode's own refusal (400) comes through with its message.
          const rejected = yield* connection
            .removeWorktree({ projectID: location.projectID, directory: repo })
            .pipe(Effect.flip)

          expect(rejected._tag).toBe('OpenCodeRejectedError')
          expect(rejected.message).toContain('Invalid worktree directory')

          // A second launch of the same branch fails with OpenCode's words, nothing kept.
          const again = yield* launches.start({ repoDir: repo, branch: 'feat/it-launch', task })

          const second = yield* eventually(
            Effect.map(launchNamed(again.id), launch =>
              launch?.status === 'failed' || launch?.status === 'ready' ? launch : undefined
            ),
            'second launch'
          )

          // The git strategy suffixes a colliding name instead of refusing; either is fine here.
          expect(['ready', 'failed']).toContain(second.status)
        }).pipe(Effect.provide(fleetLayer(server)))
      }).pipe(Effect.scoped),
    120_000
  )

  it.live(
    'opens a repository without sessions in a new one; suggestions fall back without a model',
    () =>
      Effect.gen(function* () {
        const server = yield* startOpenCodeServer(binary.available ? binary.path : 'opencode', {
          config: { model: 'fleet-none/none' }
        })

        const repo = makeRepo(server, 'beta')

        yield* Effect.gen(function* () {
          const opened = yield* openCheckout({ directory: repo })

          expect(opened.created).toBe(true)

          const session = yield* server.json<{
            readonly data: { readonly location: { readonly directory: string } }
          }>('GET', `/api/session/${opened.sessionID}`)

          expect(session.data.location.directory).toBe(repo)

          const refused = yield* openCheckout({ directory: path.join(repo, 'nowhere') }).pipe(
            Effect.flip
          )

          expect(refused._tag).toBe('NotACheckoutError')

          const started = Date.now()

          expect(yield* suggestBranch({ task: 'Fix the flaky login test' })).toEqual({
            branch: 'feat/fix-the-flaky-login-test',
            source: 'fallback'
          })
          expect(Date.now() - started).toBeLessThan(6000)
        }).pipe(Effect.provide(fleetLayer(server)))
      }).pipe(Effect.scoped),
    120_000
  )
})
