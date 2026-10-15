import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import {
  LaunchBackend,
  Launches,
  makeLaunches,
  makeWatcherBackend,
  watcherPatch
} from '@/lib/data/fleet/launches'
import { FleetStore, makeFleetStore } from '@/lib/data/fleet/store'
import { webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { RepoCheckout } from '@/lib/data/fleet/types'
import { makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import { makeFakeRepos } from '@/lib/services/repos/testing/fake-repos'
import { Watcher, WatcherUnavailableError } from '@/lib/services/watcher/service'
import type { WatcherRun } from '@/lib/services/watcher/service'

// Launches run by Watcher (the production backend): Fleet registers them under Watcher's run id,
// mirrors their progress, and picks running ones back up after its own restart.

const repo = '/home/magoz/dev/repos/fleet'

const worktree = '/home/magoz/dev/repos/fleet-feat-x'

const checkouts: ReadonlyArray<RepoCheckout> = [{ name: 'fleet', directory: repo, worktrees: [] }]

const run = (fields: Partial<WatcherRun> = {}): WatcherRun => ({
  id: 'run_1',
  watch: 'manual',
  key: 'run_1',
  status: 'launching',
  step: null,
  error: null,
  repo,
  branch: 'feat/x',
  prompt: 'Add the thing',
  sessionId: 'ses_1',
  directory: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  ...fields
})

/** A Watcher whose runs the test sets; `launch` registers `run_1`. */
const fakeWatcher = () => {
  const runs = new Map<string, WatcherRun>()
  const requests: Array<unknown> = []
  let down = false

  const unavailable = () => new WatcherUnavailableError({ message: 'Watcher is not running' })

  const layer = Layer.succeed(
    Watcher,
    Watcher.of({
      launch: request =>
        Effect.suspend(() => {
          if (down) return Effect.fail(unavailable())

          requests.push(request)
          runs.set('run_1', run())

          return Effect.succeed(run())
        }),
      run: id =>
        Effect.suspend(() =>
          down ? Effect.fail(unavailable()) : Effect.succeed(Option.fromUndefinedOr(runs.get(id)))
        ),
      launching: Effect.suspend(() =>
        Effect.succeed([...runs.values()].filter(item => item.status === 'launching'))
      )
    })
  )

  return {
    runs,
    requests,
    setDown: (value: boolean) => {
      down = value
    },
    layer
  }
}

const setUp = (watcher: ReturnType<typeof fakeWatcher>) =>
  Effect.gen(function* () {
    const fake = yield* makeFakeOpenCode()
    const repos = yield* makeFakeRepos(checkouts)
    const store = Layer.effect(FleetStore, makeFleetStore(webUrl))

    const backend = Layer.effect(LaunchBackend, makeWatcherBackend).pipe(
      Layer.provide(watcher.layer)
    )

    return Layer.effect(Launches, makeLaunches({ readyFor: '10 minutes' })).pipe(
      Layer.provide(backend),
      Layer.provideMerge(Layer.mergeAll(store, fake.layer, repos.layer))
    )
  })

const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

const launches = Effect.flatMap(FleetStore, store =>
  Effect.map(store.snapshot, snapshot => snapshot.launches)
)

describe('launches run by Watcher', () => {
  it.effect('registers the launch under the run id and mirrors its progress', () =>
    Effect.gen(function* () {
      const watcher = fakeWatcher()
      const layer = yield* setUp(watcher)

      yield* Effect.gen(function* () {
        const started = yield* (yield* Launches).start({
          repoDir: repo,
          branch: 'feat/x',
          task: ' Add the thing '
        })

        expect(started).toMatchObject({
          id: 'run_1',
          status: 'provisioning',
          task: 'Add the thing'
        })
        expect(watcher.requests).toEqual([{ repo, branch: 'feat/x', prompt: 'Add the thing' }])

        watcher.runs.set('run_1', run({ directory: worktree }))
        yield* TestClock.adjust('1 second')
        yield* settle
        expect(yield* launches).toMatchObject([{ status: 'creating-session', directory: worktree }])

        // Watcher restarting (a ship) is not a failure: Fleet keeps asking.
        watcher.setDown(true)
        yield* TestClock.adjust('30 seconds')
        yield* settle
        expect(yield* launches).toMatchObject([{ status: 'creating-session' }])

        watcher.setDown(false)
        watcher.runs.set('run_1', run({ status: 'launched', directory: worktree }))
        yield* TestClock.adjust('1 second')
        yield* settle
        expect(yield* launches).toMatchObject([
          { status: 'ready', directory: worktree, sessionID: 'ses_1' }
        ])

        yield* TestClock.adjust('10 minutes')
        yield* settle
        expect(yield* launches).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('fails a launch Watcher cannot start, registering nothing', () =>
    Effect.gen(function* () {
      const watcher = fakeWatcher()
      const layer = yield* setUp(watcher)

      watcher.setDown(true)

      yield* Effect.gen(function* () {
        const error = yield* (yield* Launches)
          .start({ repoDir: repo, branch: 'feat/x', task: 'x' })
          .pipe(Effect.flip)

        expect(error._tag).toBe('WatcherUnavailableError')
        expect(yield* launches).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('picks up launches still running after a Fleet restart', () =>
    Effect.gen(function* () {
      const watcher = fakeWatcher()

      watcher.runs.set('run_9', run({ id: 'run_9', directory: worktree }))

      const layer = yield* setUp(watcher)

      yield* Effect.gen(function* () {
        expect(yield* launches).toMatchObject([
          {
            id: 'run_9',
            repoName: 'fleet',
            branch: 'feat/x',
            task: 'Add the thing',
            status: 'creating-session',
            directory: worktree
          }
        ])

        watcher.runs.set('run_9', run({ id: 'run_9', status: 'launched', directory: worktree }))
        yield* TestClock.adjust('1 second')
        yield* settle
        expect(yield* launches).toMatchObject([{ id: 'run_9', status: 'ready' }])
      }).pipe(Effect.provide(layer))
    })
  )
})

describe('watcherPatch', () => {
  it('states a failure as Fleet did, with what was kept', () => {
    expect(
      watcherPatch(
        run({ status: 'failed', step: 'session', error: 'HTTP 500', directory: worktree })
      )
    ).toEqual({
      patch: {
        status: 'failed',
        directory: worktree,
        error: 'Creating the session failed: HTTP 500',
        preserved: `Worktree kept at ${worktree}`
      },
      end: Option.some('failed')
    })
    expect(
      watcherPatch(run({ status: 'failed', step: 'prompt', error: 'gone', directory: worktree }))
        .patch.preserved
    ).toBe(`Worktree kept at ${worktree}; session ses_1 created without the task`)
    expect(
      watcherPatch(run({ status: 'failed', step: 'worktree', error: 'branch exists' })).patch
    ).toMatchObject({ error: 'Creating the worktree failed: branch exists', preserved: undefined })
  })
})
