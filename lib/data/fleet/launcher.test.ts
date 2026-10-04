import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { busySessions, latestSessionIn } from '@/lib/data/fleet/checkouts'
import {
  buildLauncher,
  loadLauncher,
  newSession,
  openCheckout,
  retireRefusal,
  retireWorktree,
  suggestBranch
} from '@/lib/data/fleet/launcher'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import { buildRows } from '@/lib/data/fleet/snapshot'
import { FleetStore, makeFleetStore } from '@/lib/data/fleet/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import type { RepoCheckout } from '@/lib/data/fleet/types'
import { makeFakeDirectories } from '@/lib/services/directories/testing/fake-directories'
import { OpenCodeRejectedError, OpenCodeRequestError } from '@/lib/services/opencode/errors'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { CheckoutInfo } from '@/lib/services/repos/service'
import { makeFakeRepos } from '@/lib/services/repos/testing/fake-repos'
import type { FakeRepos } from '@/lib/services/repos/testing/fake-repos'

const minute = 60_000

const repos = '/home/magoz/dev/repos'

const fleet = `${repos}/fleet`

const fleetX = `${repos}/fleet-feat-x`

const fleetPi = `${repos}/fleet-pi-thing`

const box = `${repos}/box`

const anvil = `${repos}/anvil`

const zinc = `${repos}/zinc`

const fleetRepo: RepoCheckout = {
  name: 'fleet',
  directory: fleet,
  worktrees: [
    { directory: fleetPi, branch: 'pi/thing', owner: 'other' },
    { directory: fleetX, branch: 'feat/x', owner: 'dotfiles' }
  ]
}

/** `fleet` with its Pi worktree replaced by an idle, dotfiles-owned one. */
const retirable: RepoCheckout = {
  ...fleetRepo,
  worktrees: [{ directory: fleetPi, branch: 'feat/done', owner: 'dotfiles' }]
}

const checkouts: ReadonlyArray<RepoCheckout> = [
  { name: 'anvil', directory: anvil, worktrees: [] },
  fleetRepo,
  { name: 'box', directory: box, worktrees: [] },
  { name: 'zinc', directory: zinc, worktrees: [] }
]

const finished = (at: number) => ({ idle: at, outcome: 'succeeded' as const })

const snapshot: OpenCodeSnapshot = {
  ...emptySnapshot,
  sessions: [
    sessionRecord('ses_main_old', { ...finished(baseTime + minute), handled: baseTime + minute }),
    sessionRecord('ses_main_new', { ...finished(baseTime + 3 * minute) }),
    // A subfolder counts toward the primary.
    sessionRecord('ses_main_sub', {
      directory: `${fleet}/app`,
      ...finished(baseTime + 2 * minute),
      handled: baseTime + 2 * minute
    }),
    sessionRecord('ses_x_run', { directory: fleetX, created: baseTime + 4 * minute }),
    sessionRecord('ses_x_wait', { directory: fleetX, created: baseTime + minute }),
    sessionRecord('ses_box', {
      projectID: 'prj_box',
      directory: box,
      ...finished(baseTime + 5 * minute)
    }),
    // `fleet-launcher` is not inside `fleet`.
    sessionRecord('ses_sibling', { directory: `${repos}/fleet-launcher`, ...finished(baseTime) }),
    // A deleted folder inside zinc never counts.
    sessionRecord('ses_zinc_gone', { directory: `${zinc}/tmp`, ...finished(baseTime + 9 * minute) })
  ],
  running: ['ses_x_run'],
  permissions: [{ id: 'per_1', sessionID: 'ses_x_wait', action: 'bash', resources: [] }],
  projects: [
    { id: 'prj_fleet', name: 'fleet', directory: fleet },
    { id: 'prj_box', name: 'box', directory: box },
    { id: 'global', directory: '/' }
  ]
}

const model = fromSnapshot(snapshot, baseTime + 10 * minute, new Map([[`${zinc}/tmp`, true]]))

const rows = buildRows(model, webUrl)

const launcher = () =>
  buildLauncher({
    repos: checkouts,
    pullRequests: new Map([
      [fleetX, { state: 'merged', number: 12, url: 'https://github.com/o/fleet/pull/12' }]
    ]),
    projects: snapshot.projects,
    rows,
    now: baseTime + 10 * minute
  })

describe('buildLauncher', () => {
  it('orders repositories by their latest agent activity, then by name', () => {
    // fleet's worktree runs right now (active at the snapshot), box finished 5 minutes ago.
    expect(launcher().entries.map(entry => entry.name)).toEqual(['fleet', 'box', 'anvil', 'zinc'])
  })

  it("merges OpenCode's projects by directory and tallies each checkout's sessions", () => {
    const entry = launcher().entries.find(item => item.name === 'fleet')

    expect(entry).toMatchObject({
      directory: fleet,
      projectID: 'prj_fleet',
      sessions: { blocked: 0, working: 0, finished: 1, handled: 2 },
      latestSession: 'ses_main_new',
      activeAt: baseTime + 3 * minute
    })
    expect(entry?.lastActivity).toBe(baseTime + 10 * minute)
    expect(entry?.worktrees).toEqual([
      {
        directory: fleetX,
        branch: 'feat/x',
        owner: 'dotfiles',
        pr: { state: 'merged', number: 12, url: 'https://github.com/o/fleet/pull/12' },
        sessions: { blocked: 1, working: 1, finished: 0, handled: 0 },
        latestSession: 'ses_x_run',
        activeAt: entry?.worktrees[0]?.activeAt
      },
      {
        directory: fleetPi,
        branch: 'pi/thing',
        owner: 'other',
        pr: { state: 'unknown' },
        sessions: { blocked: 0, working: 0, finished: 0, handled: 0 },
        latestSession: undefined,
        activeAt: undefined
      }
    ])
  })

  it('leaves repositories OpenCode never opened without a project or sessions', () => {
    expect(launcher().entries.find(item => item.name === 'anvil')).toEqual({
      name: 'anvil',
      directory: anvil,
      projectID: undefined,
      sessions: { blocked: 0, working: 0, finished: 0, handled: 0 },
      latestSession: undefined,
      activeAt: undefined,
      worktrees: [],
      lastActivity: undefined
    })
    expect(launcher().entries.find(item => item.name === 'zinc')?.latestSession).toBeUndefined()
  })
})

describe('latestSessionIn and busySessions', () => {
  it('finds the newest live root session in a checkout or below it', () => {
    expect(latestSessionIn(rows, fleet)).toBe('ses_main_new')
    expect(latestSessionIn(rows, fleetX)).toBe('ses_x_run')
    expect(latestSessionIn(rows, `${fleet}/app`)).toBe('ses_main_sub')
    expect(latestSessionIn(rows, zinc)).toBeUndefined()
  })

  it('lists working and blocked sessions in a checkout', () => {
    expect(busySessions(rows, fleetX).map(row => row.id)).toEqual(['ses_x_wait', 'ses_x_run'])
    expect(busySessions(rows, fleet)).toEqual([])
  })
})

const worktreeInfo = (overrides: Partial<CheckoutInfo> = {}): Option.Option<CheckoutInfo> =>
  Option.some({
    directory: fleetX,
    primary: fleet,
    linked: true,
    branch: 'feat/x',
    owner: 'dotfiles',
    ...overrides
  })

describe('retireRefusal', () => {
  it('allows only idle dotfiles-owned linked worktrees', () => {
    expect(retireRefusal(worktreeInfo({ directory: fleetPi }), rows)).toEqual(Option.none())
    expect(retireRefusal(worktreeInfo(), rows)).toEqual(
      Option.some('2 sessions there are working or blocked')
    )
    expect(retireRefusal(worktreeInfo({ directory: fleetPi, owner: 'other' }), rows)).toEqual(
      Option.some('Not a Fleet/OpenCode worktree (no dotfiles marker); retire it through Herdr')
    )
    expect(retireRefusal(worktreeInfo({ directory: fleet, linked: false }), rows)).toEqual(
      Option.some('The primary checkout cannot be retired')
    )
    expect(retireRefusal(Option.none(), rows)).toEqual(Option.some('Not a git checkout on Box'))
  })
})

/** Fake OpenCode and repositories, and a store holding the watcher's view of `snapshot`. */
const services = (fake: FakeOpenCode, fakeRepos: FakeRepos) =>
  Effect.map(makeFakeDirectories(), directories =>
    Layer.mergeAll(
      fake.layer,
      fakeRepos.layer,
      directories.layer,
      Layer.effect(
        FleetStore,
        Effect.gen(function* () {
          const store = yield* makeFleetStore(webUrl)

          yield* store.commit(view => ({ ...view, model }))

          return store
        })
      )
    )
  )

const setUp = Effect.gen(function* () {
  const fake = yield* makeFakeOpenCode(snapshot)
  const fakeRepos = yield* makeFakeRepos(checkouts)

  return { fake, fakeRepos, layer: yield* services(fake, fakeRepos) }
})

describe('loadLauncher', () => {
  it.effect("scans with OpenCode's project folders and looks up each worktree branch's PR", () =>
    Effect.gen(function* () {
      const { fakeRepos, layer } = yield* setUp

      yield* fakeRepos.setPullRequest(fleet, 'feat/x', { state: 'open', number: 3 })

      const list = yield* loadLauncher.pipe(Effect.provide(layer))

      expect(yield* fakeRepos.listed).toEqual([[fleet, box]])
      expect(
        list.entries.find(entry => entry.name === 'fleet')?.worktrees.map(item => item.pr)
      ).toEqual([{ state: 'open', number: 3 }, { state: 'none' }])
    })
  )
})

describe('openCheckout', () => {
  it.effect('resumes the latest root session there', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      expect(yield* openCheckout({ directory: fleetX }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_x_run',
        created: false
      })
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('creates an empty session in a checkout without one', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      expect(yield* openCheckout({ directory: fleetPi }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_created_1',
        created: true
      })
      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([
        { op: 'createSession', directory: fleetPi, title: undefined }
      ])
    })
  )

  it.effect('refuses a folder that is not a checkout', () =>
    Effect.gen(function* () {
      const { layer } = yield* setUp

      const error = yield* openCheckout({ directory: '/tmp/elsewhere' }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      expect(error._tag).toBe('NotACheckoutError')
    })
  )
})

describe('newSession', () => {
  it.effect('always creates a new empty session, even where one exists', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      expect(yield* newSession({ directory: fleetX }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_created_1'
      })
      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([
        { op: 'createSession', directory: fleetX, title: undefined }
      ])
    })
  )

  it.effect('refuses a folder that is not a checkout', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      const error = yield* newSession({ directory: '/tmp/elsewhere' }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      expect(error._tag).toBe('NotACheckoutError')
      expect(yield* fake.calls).toEqual([])
    })
  )
})

describe('retireWorktree', () => {
  it.effect('removes an idle dotfiles worktree without force; its sessions become gone', () =>
    Effect.gen(function* () {
      const { fake, fakeRepos, layer } = yield* setUp

      yield* fakeRepos.setRepos([retirable])

      yield* retireWorktree({ projectID: 'prj_fleet', directory: fleetPi }).pipe(
        Effect.provide(layer)
      )

      expect((yield* fake.calls).filter(call => call.op === 'removeWorktree')).toEqual([
        { op: 'removeWorktree', projectID: 'prj_fleet', directory: fleetPi }
      ])
    })
  )

  it.effect('refuses busy or foreign worktrees before calling OpenCode', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      const busy = yield* retireWorktree({ projectID: 'prj_fleet', directory: fleetX }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      const foreign = yield* retireWorktree({ projectID: 'prj_fleet', directory: fleetPi }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      expect(busy._tag).toBe('RetireRefusedError')
      expect(busy).toMatchObject({ reason: '2 sessions there are working or blocked' })
      expect(foreign._tag).toBe('RetireRefusedError')
      expect((yield* fake.calls).filter(call => call.op === 'removeWorktree')).toEqual([])
    })
  )

  it.effect("passes OpenCode's refusal through", () =>
    Effect.gen(function* () {
      const { fake, fakeRepos, layer } = yield* setUp

      yield* fakeRepos.setRepos([retirable])

      yield* fake.setLauncherBehavior({
        removeWorktree: () =>
          Effect.fail(
            new OpenCodeRejectedError({
              operation: 'worktree.remove',
              message: 'worktree-manage: refusing dirty checkout'
            })
          )
      })

      const error = yield* retireWorktree({ projectID: 'prj_fleet', directory: fleetPi }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      expect(error._tag).toBe('OpenCodeRejectedError')
      expect(error.message).toBe('worktree-manage: refusing dirty checkout')
    })
  )
})

describe('suggestBranch', () => {
  const task = 'Add a launcher palette to Fleet'

  it.effect("uses the model's answer when it is one valid branch name", () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      yield* fake.setLauncherBehavior({
        generateText: () => Effect.succeed('`feat/launcher-palette`\n')
      })

      expect(yield* suggestBranch({ task }).pipe(Effect.provide(layer))).toEqual({
        branch: 'feat/launcher-palette',
        source: 'model'
      })
      expect((yield* fake.calls).find(call => call.op === 'generateText')).toMatchObject({
        op: 'generateText'
      })
    })
  )

  it.effect('falls back to the slug on invalid output, failure, or no answer within 4s', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp
      const fallback = { branch: 'feat/add-a-launcher-palette-to-fleet', source: 'fallback' }

      yield* fake.setLauncherBehavior({
        generateText: () => Effect.succeed('Sure! Here is a branch: feat/launcher')
      })
      expect(yield* suggestBranch({ task }).pipe(Effect.provide(layer))).toEqual(fallback)

      yield* fake.setLauncherBehavior({
        generateText: () =>
          Effect.fail(new OpenCodeRequestError({ operation: 'generate.text', message: 'no model' }))
      })
      expect(yield* suggestBranch({ task }).pipe(Effect.provide(layer))).toEqual(fallback)

      yield* fake.setLauncherBehavior({
        generateText: () => Effect.as(Effect.sleep('10 seconds'), 'feat/too-late')
      })

      const fiber = yield* suggestBranch({ task }).pipe(Effect.provide(layer), Effect.forkChild)

      yield* TestClock.adjust('4 seconds')

      expect(yield* Fiber.join(fiber)).toEqual(fallback)
    })
  )
})
