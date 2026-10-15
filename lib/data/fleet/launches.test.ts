import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { diffSnapshots } from '@/lib/data/fleet/change'
import { InProcessBackendLive, Launches, makeLaunches } from '@/lib/data/fleet/launches'
import { FleetStore, makeFleetStore } from '@/lib/data/fleet/store'
import { webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { RepoCheckout } from '@/lib/data/fleet/types'
import {
  OpenCodeRejectedError,
  OpenCodeRequestError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'
import { makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type {
  FakeLauncherBehavior,
  FakeOpenCode
} from '@/lib/services/opencode/testing/fake-opencode'
import { makeFakeRepos } from '@/lib/services/repos/testing/fake-repos'

const repo = '/home/magoz/dev/repos/fleet'

const worktree = '/home/magoz/dev/repos/fleet-feat-x'

const checkouts: ReadonlyArray<RepoCheckout> = [
  {
    name: 'fleet',
    directory: repo,
    worktrees: [{ directory: '/home/magoz/dev/repos/fleet-pi', branch: 'pi/x', owner: 'other' }]
  }
]

const task = 'Add the launcher palette'

/** The registry over a fresh store, the fake OpenCode (with `behavior`) and fake repositories. */
const setUp = (behavior: Partial<FakeLauncherBehavior> = {}) =>
  Effect.gen(function* () {
    const fake = yield* makeFakeOpenCode()
    const repos = yield* makeFakeRepos(checkouts)

    yield* fake.setLauncherBehavior({
      createWorktree: () => Effect.as(Effect.sleep('2 minutes'), worktree),
      ...behavior
    })

    const store = Layer.effect(FleetStore, makeFleetStore(webUrl))

    const layer = Layer.effect(Launches, makeLaunches({ readyFor: '10 minutes' })).pipe(
      Layer.provide(InProcessBackendLive),
      Layer.provideMerge(Layer.mergeAll(store, fake.layer, repos.layer))
    )

    return { fake, layer }
  })

/** Lets forked fibers run until they wait on the clock. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

const launches = Effect.flatMap(FleetStore, store =>
  Effect.map(store.snapshot, snapshot => snapshot.launches)
)

const only = Effect.flatMap(launches, list => {
  const [launch, ...rest] = list

  return launch === undefined || rest.length > 0
    ? Effect.die(new Error(`expected one launch, got ${list.length}`))
    : Effect.succeed(launch)
})

const launcherCalls = (fake: FakeOpenCode) =>
  Effect.map(fake.calls, calls =>
    calls.filter(call =>
      ['resolveLocation', 'createWorktree', 'createSession', 'prompt'].includes(call.op)
    )
  )

describe('launches', () => {
  it.effect('provisions in the background, then creates the session, sends the task, expires', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      yield* Effect.gen(function* () {
        const registry = yield* Launches
        const store = yield* FleetStore
        const before = yield* store.snapshot

        const started = yield* registry.start({
          repoDir: repo,
          branch: 'feat/x',
          task: `  ${task} `
        })

        expect(started).toMatchObject({
          repo,
          repoName: 'fleet',
          branch: 'feat/x',
          task,
          status: 'provisioning'
        })

        // Published to clients: the snapshot and the next `fleet.changed` carry it.
        expect(diffSnapshots(before, yield* store.snapshot)?.launches).toEqual([started])

        yield* settle
        expect((yield* only).status).toBe('provisioning')

        yield* TestClock.adjust('2 minutes')
        yield* settle

        expect(yield* only).toMatchObject({
          id: started.id,
          status: 'ready',
          directory: worktree,
          sessionID: 'ses_created_1'
        })
        expect(yield* launcherCalls(fake)).toEqual([
          { op: 'resolveLocation', directory: repo },
          { op: 'createWorktree', projectID: 'prj_fleet', name: 'feat--x' },
          { op: 'createSession', directory: worktree, title: undefined },
          { op: 'prompt', sessionID: 'ses_created_1', text: task }
        ])

        yield* TestClock.adjust('9 minutes')
        expect((yield* launches).map(launch => launch.status)).toEqual(['ready'])

        yield* TestClock.adjust('1 minute')
        yield* settle
        expect(yield* launches).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("fails with OpenCode's refusal when the worktree cannot be created; stays listed", () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp({
        createWorktree: () =>
          Effect.fail(
            new OpenCodeRejectedError({
              operation: 'worktree.create',
              message: 'worktree: branch feat/x already exists'
            })
          )
      })

      yield* Effect.gen(function* () {
        const registry = yield* Launches
        const started = yield* registry.start({ repoDir: repo, branch: 'feat/x', task })

        yield* settle

        const failed = yield* only

        expect(failed).toMatchObject({
          status: 'failed',
          error: 'Creating the worktree failed: worktree: branch feat/x already exists'
        })
        expect(failed.preserved).toBeUndefined()
        expect((yield* fake.calls).some(call => call.op === 'createSession')).toBe(false)

        yield* TestClock.adjust('1 hour')
        expect((yield* launches).map(launch => launch.status)).toEqual(['failed'])

        yield* registry.dismiss(started.id)
        expect(yield* launches).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('says what was kept when the session or the task fails', () =>
    Effect.gen(function* () {
      const session = yield* setUp({
        createWorktree: () => Effect.succeed(worktree),
        createSession: () =>
          Effect.fail(
            new OpenCodeRequestError({ operation: 'session.create', message: 'HTTP 500' })
          )
      })

      yield* Effect.gen(function* () {
        yield* (yield* Launches).start({ repoDir: repo, branch: 'feat/x', task })
        yield* settle

        expect(yield* only).toMatchObject({
          status: 'failed',
          directory: worktree,
          error: 'Creating the session failed: OpenCode did not complete session.create (HTTP 500)',
          preserved: `Worktree kept at ${worktree}`
        })
      }).pipe(Effect.provide(session.layer))

      const prompt = yield* setUp({
        createWorktree: () => Effect.succeed(worktree),
        prompt: ({ sessionID }) => Effect.fail(new SessionNotFoundError({ sessionID }))
      })

      yield* Effect.gen(function* () {
        yield* (yield* Launches).start({ repoDir: repo, branch: 'feat/x', task })
        yield* settle

        expect(yield* only).toMatchObject({
          status: 'failed',
          sessionID: 'ses_created_1',
          error: 'Sending the task failed: the session disappeared',
          preserved: `Worktree kept at ${worktree}; session ses_created_1 created without the task`
        })
      }).pipe(Effect.provide(prompt.layer))
    })
  )

  it.effect('refuses anything but a primary checkout, and branches without an exact name', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      yield* Effect.gen(function* () {
        const registry = yield* Launches

        const linked = yield* registry
          .start({ repoDir: '/home/magoz/dev/repos/fleet-pi', branch: 'feat/x', task })
          .pipe(Effect.flip)

        const unknown = yield* registry
          .start({ repoDir: '/tmp/nowhere', branch: 'feat/x', task })
          .pipe(Effect.flip)

        const branch = yield* registry
          .start({ repoDir: repo, branch: 'main', task })
          .pipe(Effect.flip)

        expect([linked._tag, unknown._tag, branch._tag]).toEqual([
          'NotACheckoutError',
          'NotACheckoutError',
          'OpenCodeInvalidInputError'
        ])
        expect(yield* launches).toEqual([])
        expect(yield* launcherCalls(fake)).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('dismisses only finished launches', () =>
    Effect.gen(function* () {
      const { layer } = yield* setUp()

      yield* Effect.gen(function* () {
        const registry = yield* Launches
        const started = yield* registry.start({ repoDir: repo, branch: 'feat/x', task })

        expect((yield* registry.dismiss(started.id).pipe(Effect.flip))._tag).toBe(
          'LaunchInProgressError'
        )
        expect((yield* registry.dismiss('nope').pipe(Effect.flip))._tag).toBe('LaunchNotFoundError')

        yield* TestClock.adjust('2 minutes')
        yield* settle
        yield* registry.dismiss(started.id)
        expect(yield* launches).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )
})
