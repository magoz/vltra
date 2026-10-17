import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { busySessions, latestSessionIn } from '@/lib/data/vltra/checkouts'
import {
  buildLauncher,
  loadLauncher,
  newSession,
  openCheckout,
  retireRefusal,
  retireWorktree,
  suggestBranch
} from '@/lib/data/vltra/launcher'
import { fromSnapshot } from '@/lib/data/vltra/model'
import type { OpenCodeSnapshot } from '@/lib/data/vltra/model'
import { buildRows } from '@/lib/data/vltra/snapshot'
import { VltraStore, makeVltraStore } from '@/lib/data/vltra/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { RepoCheckout } from '@/lib/data/vltra/types'
import { makeFakeDirectories } from '@/lib/services/directories/testing/fake-directories'
import { OpenCodeRejectedError, OpenCodeRequestError } from '@/lib/services/opencode/errors'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { CheckoutInfo } from '@/lib/services/repos/service'
import { makeFakeRepos } from '@/lib/services/repos/testing/fake-repos'
import type { FakeRepos } from '@/lib/services/repos/testing/fake-repos'

const minute = 60_000

const repos = '/home/me/dev/repos'

const vltra = `${repos}/vltra`

const vltraX = `${repos}/vltra-feat-x`

const vltraPi = `${repos}/vltra-pi-thing`

const box = `${repos}/box`

const anvil = `${repos}/anvil`

const zinc = `${repos}/zinc`

const subs = '/home/me/subs'

const vltraRepo: RepoCheckout = {
  name: 'vltra',
  directory: vltra,
  worktrees: [
    { directory: vltraPi, branch: 'pi/thing', owner: 'other' },
    { directory: vltraX, branch: 'feat/x', owner: 'dotfiles' }
  ]
}

/** `vltra` with its Pi worktree replaced by an idle, dotfiles-owned one. */
const retirable: RepoCheckout = {
  ...vltraRepo,
  worktrees: [{ directory: vltraPi, branch: 'feat/done', owner: 'dotfiles' }]
}

const checkouts: ReadonlyArray<RepoCheckout> = [
  { name: 'anvil', directory: anvil, worktrees: [] },
  vltraRepo,
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
      directory: `${vltra}/app`,
      ...finished(baseTime + 2 * minute),
      handled: baseTime + 2 * minute
    }),
    sessionRecord('ses_x_run', { directory: vltraX, created: baseTime + 4 * minute }),
    sessionRecord('ses_x_wait', { directory: vltraX, created: baseTime + minute }),
    sessionRecord('ses_box', {
      projectID: 'prj_box',
      directory: box,
      ...finished(baseTime + 5 * minute)
    }),
    // `vltra-launcher` is not inside `vltra`.
    sessionRecord('ses_sibling', { directory: `${repos}/vltra-launcher`, ...finished(baseTime) }),
    sessionRecord('ses_subs', { projectID: 'global', directory: subs, ...finished(baseTime) }),
    // A deleted folder inside zinc never counts.
    sessionRecord('ses_zinc_gone', { directory: `${zinc}/tmp`, ...finished(baseTime + 9 * minute) })
  ],
  running: ['ses_x_run'],
  permissions: [{ id: 'per_1', sessionID: 'ses_x_wait', action: 'bash', resources: [] }],
  projects: [
    { id: 'prj_vltra', name: 'vltra', directory: vltra },
    { id: 'prj_box', name: 'box', directory: box },
    { id: 'global', directory: '/' }
  ]
}

const model = fromSnapshot(snapshot, baseTime + 10 * minute, new Map([[`${zinc}/tmp`, true]]))

const rows = buildRows(model, webUrl)

const launcher = () =>
  buildLauncher({
    repos: checkouts,
    folders: [subs],
    pullRequests: new Map([
      [vltraX, { state: 'merged', number: 12, url: 'https://github.com/o/vltra/pull/12' }]
    ]),
    projects: snapshot.projects,
    rows,
    now: baseTime + 10 * minute
  })

describe('buildLauncher', () => {
  it('orders repositories by their latest agent activity, then by name', () => {
    // vltra's worktree runs right now (active at the snapshot), box finished 5 minutes ago.
    expect(launcher().entries.map(entry => entry.name)).toEqual([
      'vltra',
      'box',
      'subs',
      'anvil',
      'zinc'
    ])
  })

  it("merges OpenCode's projects by directory and tallies each checkout's sessions", () => {
    const entry = launcher().entries.find(item => item.name === 'vltra')

    expect(entry).toMatchObject({
      directory: vltra,
      projectID: 'prj_vltra',
      sessions: { blocked: 0, working: 0, finished: 1, handled: 2 },
      latestSession: 'ses_main_new',
      activeAt: baseTime + 3 * minute
    })
    expect(entry?.lastActivity).toBe(baseTime + 10 * minute)
    expect(entry?.worktrees).toEqual([
      {
        directory: vltraX,
        branch: 'feat/x',
        owner: 'dotfiles',
        pr: { state: 'merged', number: 12, url: 'https://github.com/o/vltra/pull/12' },
        sessions: { blocked: 1, working: 1, finished: 0, handled: 0 },
        latestSession: 'ses_x_run',
        activeAt: entry?.worktrees[0]?.activeAt
      },
      {
        directory: vltraPi,
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
      kind: 'repo',
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

  it('lists plain-folder roots with their own sessions, without a project or worktrees', () => {
    expect(launcher().entries.find(item => item.name === 'subs')).toEqual({
      kind: 'folder',
      name: 'subs',
      directory: subs,
      sessions: { blocked: 0, working: 0, finished: 1, handled: 0 },
      latestSession: 'ses_subs',
      activeAt: baseTime,
      worktrees: [],
      lastActivity: baseTime
    })
  })
})

describe('latestSessionIn and busySessions', () => {
  it('finds the newest live root session in a checkout or below it', () => {
    expect(latestSessionIn(rows, vltra)).toBe('ses_main_new')
    expect(latestSessionIn(rows, vltraX)).toBe('ses_x_run')
    expect(latestSessionIn(rows, `${vltra}/app`)).toBe('ses_main_sub')
    expect(latestSessionIn(rows, zinc)).toBeUndefined()
  })

  it('lists working and blocked sessions in a checkout', () => {
    expect(busySessions(rows, vltraX).map(row => row.id)).toEqual(['ses_x_wait', 'ses_x_run'])
    expect(busySessions(rows, vltra)).toEqual([])
  })
})

const worktreeInfo = (overrides: Partial<CheckoutInfo> = {}): Option.Option<CheckoutInfo> =>
  Option.some({
    directory: vltraX,
    primary: vltra,
    linked: true,
    branch: 'feat/x',
    owner: 'dotfiles',
    ...overrides
  })

describe('retireRefusal', () => {
  it('allows only idle dotfiles-owned linked worktrees', () => {
    expect(retireRefusal(worktreeInfo({ directory: vltraPi }), rows)).toEqual(Option.none())
    expect(retireRefusal(worktreeInfo(), rows)).toEqual(
      Option.some('2 sessions there are working or blocked')
    )
    expect(retireRefusal(worktreeInfo({ directory: vltraPi, owner: 'other' }), rows)).toEqual(
      Option.some('Not a Vltra/OpenCode worktree (no dotfiles marker); retire it through Herdr')
    )
    expect(retireRefusal(worktreeInfo({ directory: vltra, linked: false }), rows)).toEqual(
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
        VltraStore,
        Effect.gen(function* () {
          const store = yield* makeVltraStore(webUrl)

          yield* store.commit(view => ({ ...view, model }))

          return store
        })
      )
    )
  )

const setUp = Effect.gen(function* () {
  const fake = yield* makeFakeOpenCode(snapshot)
  const fakeRepos = yield* makeFakeRepos(checkouts, [subs])

  return { fake, fakeRepos, layer: yield* services(fake, fakeRepos) }
})

describe('loadLauncher', () => {
  it.effect("scans with OpenCode's project folders and looks up each worktree branch's PR", () =>
    Effect.gen(function* () {
      const { fakeRepos, layer } = yield* setUp

      yield* fakeRepos.setPullRequest(vltra, 'feat/x', { state: 'open', number: 3 })

      const list = yield* loadLauncher.pipe(Effect.provide(layer))

      expect(yield* fakeRepos.listed).toEqual([[vltra, box]])
      expect(
        list.entries.find(entry => entry.name === 'vltra')?.worktrees.map(item => item.pr)
      ).toEqual([{ state: 'open', number: 3 }, { state: 'none' }])
      expect(list.entries.find(entry => entry.directory === subs)?.kind).toBe('folder')
    })
  )
})

describe('openCheckout', () => {
  it.effect('resumes the latest root session there', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      expect(yield* openCheckout({ directory: vltraX }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_x_run',
        created: false
      })
      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('creates an empty session in a checkout without one', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      expect(yield* openCheckout({ directory: vltraPi }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_created_1',
        created: true
      })
      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([
        { op: 'createSession', directory: vltraPi, title: undefined }
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

      expect(yield* newSession({ directory: vltraX }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_created_1'
      })
      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([
        { op: 'createSession', directory: vltraX, title: undefined }
      ])
    })
  )

  it.effect('creates one in a plain-folder launcher root', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      expect(yield* newSession({ directory: subs }).pipe(Effect.provide(layer))).toEqual({
        sessionID: 'ses_created_1'
      })
      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([
        { op: 'createSession', directory: subs, title: undefined }
      ])
    })
  )

  it.effect('refuses a folder that is not a checkout or a launcher root', () =>
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

      yield* retireWorktree({ projectID: 'prj_vltra', directory: vltraPi }).pipe(
        Effect.provide(layer)
      )

      expect((yield* fake.calls).filter(call => call.op === 'removeWorktree')).toEqual([
        { op: 'removeWorktree', projectID: 'prj_vltra', directory: vltraPi }
      ])
    })
  )

  it.effect('refuses busy or foreign worktrees before calling OpenCode', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp

      const busy = yield* retireWorktree({ projectID: 'prj_vltra', directory: vltraX }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      const foreign = yield* retireWorktree({ projectID: 'prj_vltra', directory: vltraPi }).pipe(
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

      const error = yield* retireWorktree({ projectID: 'prj_vltra', directory: vltraPi }).pipe(
        Effect.provide(layer),
        Effect.flip
      )

      expect(error._tag).toBe('OpenCodeRejectedError')
      expect(error.message).toBe('worktree-manage: refusing dirty checkout')
    })
  )
})

describe('suggestBranch', () => {
  const task = 'Add a launcher palette to Vltra'

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
      const fallback = { branch: 'feat/add-a-launcher-palette-to-vltra', source: 'fallback' }

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
