import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import {
  dismissLaunchResponse,
  failureStatus,
  launchResponse,
  markHandledResponse,
  openCheckoutResponse,
  reopenResponse
} from '@/app/api/fleet/mutations'
import { failureMessage } from '@/app/fleet-action-result'
import type { FleetActionError } from '@/app/fleet-action-result'
import { CrossSiteRequestError } from '@/app/same-origin'
import {
  LaunchInProgressError,
  LaunchNotFoundError,
  NotACheckoutError,
  RetireRefusedError,
  SessionFolderGoneError,
  SessionNotFinishedError
} from '@/lib/data/fleet/errors'
import { Launches, makeLaunches } from '@/lib/data/fleet/launches'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import { FleetStore, makeFleetStore } from '@/lib/data/fleet/store'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import { ApiFailure, LaunchStarted } from '@/lib/data/fleet/types'
import type { RepoCheckout } from '@/lib/data/fleet/types'
import { makeFakeDirectories } from '@/lib/services/directories/testing/fake-directories'
import {
  OpenCodeInvalidInputError,
  OpenCodeRejectedError,
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import type { FakeLauncherBehavior } from '@/lib/services/opencode/testing/fake-opencode'
import { makeFakeRepos } from '@/lib/services/repos/testing/fake-repos'

// Route-level tests of the terminal plugin's JSON mutation routes: real `Request`s in, `Response`s
// out, over the fake OpenCode, repositories and directories (never a live service).

const idle = baseTime + 10

const repo = '/home/magoz/dev/repos/fleet'

const featX = '/home/magoz/dev/repos/fleet-feat-x'

const fleetPi = '/home/magoz/dev/repos/fleet-pi'

const gone = '/tmp/tmp.gone'

const checkouts: ReadonlyArray<RepoCheckout> = [
  {
    name: 'fleet',
    directory: repo,
    worktrees: [
      { directory: featX, branch: 'feat/x', owner: 'dotfiles' },
      { directory: fleetPi, branch: 'pi/x', owner: 'other' }
    ]
  }
]

const snapshot: OpenCodeSnapshot = {
  ...emptySnapshot,
  sessions: [
    sessionRecord('ses_finished', { directory: featX, idle, outcome: 'succeeded' }),
    sessionRecord('ses_handled', { idle, handled: idle, outcome: 'succeeded' }),
    sessionRecord('ses_working', { idle, outcome: 'succeeded' }),
    sessionRecord('ses_gone_handled', { directory: gone, idle, handled: idle, outcome: 'failed' })
  ],
  running: ['ses_working']
}

/** Every service the routes use, over one store holding the watcher's view of `snapshot`. */
const setUp = (behavior: Partial<FakeLauncherBehavior> = {}) =>
  Effect.gen(function* () {
    const fake = yield* makeFakeOpenCode(snapshot)
    const repos = yield* makeFakeRepos(checkouts)
    const directories = yield* makeFakeDirectories([gone])

    yield* fake.setLauncherBehavior(behavior)

    const store = Layer.effect(
      FleetStore,
      Effect.gen(function* () {
        const created = yield* makeFleetStore(webUrl)

        yield* created.commit(view => ({ ...view, model: fromSnapshot(snapshot, baseTime) }))

        return created
      })
    )

    const layer = Layer.effect(Launches, makeLaunches({ readyFor: '10 minutes' })).pipe(
      Layer.provideMerge(Layer.mergeAll(store, fake.layer, repos.layer, directories.layer))
    )

    return { fake, layer }
  })

const origin = 'https://fleet.oox.sh'

/** What the plugin sends: Fleet's own `Origin`, JSON. */
const pluginHeaders = {
  origin,
  host: 'fleet.oox.sh',
  'content-type': 'application/json'
}

const post = (path: string, body: string = '{}', headers: HeadersInit = pluginHeaders) =>
  new Request(`${origin}${path}`, { method: 'POST', headers, body })

const crossSite = { ...pluginHeaders, origin: 'https://evil.example' }

const notJson = { ...pluginHeaders, 'content-type': 'text/plain' }

/** Status and parsed JSON body of a route's answer. */
const read = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.text()),
    text => ({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      body: JSON.parse(text)
    })
  )

const failure = (status: number, error: string) => ({
  status,
  cacheControl: 'no-store',
  body: { error }
})

const ok = <A>(body: A) => ({ status: 200, cacheControl: 'no-store', body })

/** Lets forked fibers run until they wait on the clock. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

const launches = Effect.flatMap(FleetStore, store =>
  Effect.map(store.snapshot, current => current.launches)
)

describe('POST /api/fleet/sessions/:id/handled', () => {
  it.effect('200: marks a finished session handled; then already-handled', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      yield* Effect.gen(function* () {
        expect(
          yield* Effect.flatMap(
            markHandledResponse(post('/api/fleet/sessions/ses_finished/handled'), 'ses_finished'),
            read
          )
        ).toEqual(ok({ sessionID: 'ses_finished', outcome: 'handled' }))

        expect(
          yield* Effect.flatMap(
            markHandledResponse(post('/api/fleet/sessions/ses_handled/handled'), 'ses_handled'),
            read
          )
        ).toEqual(ok({ sessionID: 'ses_handled', outcome: 'already-handled' }))
      }).pipe(Effect.provide(layer))

      expect(yield* fake.calls).toEqual([
        { op: 'setHandled', sessionID: 'ses_finished', handled: idle }
      ])
    })
  )

  it.effect('400 for an invalid id or body, 404 unknown, 409 not finished', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const answer = (id: string, body?: string) =>
        Effect.flatMap(markHandledResponse(post(`/api/fleet/sessions/x/handled`, body), id), read)

      yield* Effect.gen(function* () {
        expect(yield* answer('x'.repeat(201))).toEqual(failure(400, 'Invalid input'))
        expect(yield* answer('ses_finished', '')).toEqual(failure(400, 'Invalid input'))
        expect(yield* answer('ses_finished', 'null')).toEqual(failure(400, 'Invalid input'))
        expect(yield* answer('ses_missing')).toEqual(failure(404, 'Session not found'))
        expect(yield* answer('ses_working')).toEqual(
          failure(409, 'Only a finished session can be marked handled')
        )
      }).pipe(Effect.provide(layer))

      expect(yield* fake.calls).toEqual([])
    })
  )

  it.effect('403 cross-site or without Origin, 415 not JSON: nothing reaches OpenCode', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const answer = (headers: HeadersInit) =>
        Effect.flatMap(
          markHandledResponse(
            post('/api/fleet/sessions/ses_finished/handled', '{}', headers),
            'ses_finished'
          ),
          read
        )

      yield* Effect.gen(function* () {
        expect(yield* answer(crossSite)).toEqual(failure(403, 'Request rejected'))
        expect(yield* answer({ ...pluginHeaders, 'sec-fetch-site': 'cross-site' })).toEqual(
          failure(403, 'Request rejected')
        )
        expect(yield* answer({ host: 'fleet.oox.sh', 'content-type': 'application/json' })).toEqual(
          failure(403, 'Request rejected')
        )
        expect(yield* answer(notJson)).toEqual(failure(415, 'JSON only'))
        // Behind the proxy: the forwarded host counts.
        expect(
          yield* answer({
            ...pluginHeaders,
            host: '127.0.0.1:3940',
            'x-forwarded-host': 'fleet.oox.sh'
          })
        ).toEqual(ok({ sessionID: 'ses_finished', outcome: 'handled' }))
      }).pipe(Effect.provide(layer))

      expect((yield* fake.calls).length).toBe(1)
    })
  )

  it.effect('503 when OpenCode is unavailable', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      yield* fake.failConnects(1)

      expect(
        yield* Effect.flatMap(
          markHandledResponse(post('/api/fleet/sessions/ses_finished/handled'), 'ses_finished'),
          read
        ).pipe(Effect.provide(layer))
      ).toEqual(failure(503, 'OpenCode is not reachable'))
    })
  )
})

describe('POST /api/fleet/sessions/:id/reopen', () => {
  it.effect('200: removes the marker; not-handled when there is none', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const answer = (id: string) =>
        Effect.flatMap(reopenResponse(post(`/api/fleet/sessions/${id}/reopen`), id), read)

      yield* Effect.gen(function* () {
        expect(yield* answer('ses_handled')).toEqual(
          ok({ sessionID: 'ses_handled', outcome: 'reopened' })
        )
        expect(yield* answer('ses_finished')).toEqual(
          ok({ sessionID: 'ses_finished', outcome: 'not-handled' })
        )
      }).pipe(Effect.provide(layer))

      expect(yield* fake.calls).toEqual([
        { op: 'setHandled', sessionID: 'ses_handled', handled: undefined }
      ])
    })
  )

  it.effect('400 invalid, 404 unknown, 409 folder gone, 403, 415, 503', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const answer = (id: string, body = '{}', headers: HeadersInit = pluginHeaders) =>
        Effect.flatMap(
          reopenResponse(post(`/api/fleet/sessions/x/reopen`, body, headers), id),
          read
        )

      yield* Effect.gen(function* () {
        expect(yield* answer('')).toEqual(failure(400, 'Invalid input'))
        expect(yield* answer('ses_handled', 'not json')).toEqual(failure(400, 'Invalid input'))
        expect(yield* answer('ses_missing')).toEqual(failure(404, 'Session not found'))
        expect(yield* answer('ses_gone_handled')).toEqual(
          failure(409, "The session's folder no longer exists")
        )
        expect(yield* answer('ses_handled', '{}', crossSite)).toEqual(
          failure(403, 'Request rejected')
        )
        expect(yield* answer('ses_handled', '{}', notJson)).toEqual(failure(415, 'JSON only'))

        yield* fake.failConnects(1)
        expect(yield* answer('ses_handled')).toEqual(failure(503, 'OpenCode is not reachable'))
      }).pipe(Effect.provide(layer))

      expect(yield* fake.calls).toEqual([])
    })
  )
})

describe('POST /api/fleet/launches', () => {
  const body = JSON.stringify({ repoDir: repo, branch: 'feat/y', task: 'Add the JSON routes' })

  it.effect('200 { launchID } at once; the launch is in the snapshot', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp({
        createWorktree: ({ name }) => Effect.as(Effect.sleep('2 minutes'), `/worktrees/${name}`)
      })

      yield* Effect.gen(function* () {
        const answer = yield* Effect.flatMap(
          launchResponse(post('/api/fleet/launches', body)),
          read
        )

        const { launchID } = yield* Schema.decodeUnknownEffect(LaunchStarted)(answer.body)

        expect(answer).toEqual(ok({ launchID }))

        yield* settle

        expect(yield* launches).toEqual([
          expect.objectContaining({
            id: launchID,
            repo,
            branch: 'feat/y',
            task: 'Add the JSON routes',
            status: 'provisioning'
          })
        ])
      }).pipe(Effect.provide(layer))

      expect((yield* fake.calls).map(call => call.op)).toEqual([
        'resolveLocation',
        'createWorktree'
      ])
    })
  )

  it.effect('400 invalid input or not a repository, 403, 415, 503', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const answer = (text: string, headers: HeadersInit = pluginHeaders) =>
        Effect.flatMap(launchResponse(post('/api/fleet/launches', text, headers)), read)

      const launch = (repoDir: string, branch: string, task: string) =>
        answer(JSON.stringify({ repoDir, branch, task }))

      yield* Effect.gen(function* () {
        expect(yield* answer('{')).toEqual(failure(400, 'Invalid input'))
        expect(yield* answer('{}')).toEqual(failure(400, 'Invalid input'))
        expect(yield* launch('dev/repos/fleet', 'feat/y', 'x')).toEqual(
          failure(400, 'Invalid input')
        )
        expect(yield* launch(repo, 'Not A Branch', 'x')).toEqual(failure(400, 'Invalid input'))
        expect(yield* launch(repo, 'feat/y', '   ')).toEqual(failure(400, 'Invalid input'))
        expect(yield* launch('/tmp/elsewhere', 'feat/y', 'x')).toEqual(
          failure(400, 'Not a git checkout on Box')
        )
        // A linked worktree is not a repository to branch from.
        expect(yield* launch(featX, 'feat/y', 'x')).toEqual(
          failure(400, 'Not a git checkout on Box')
        )
        expect(yield* answer(body, crossSite)).toEqual(failure(403, 'Request rejected'))
        expect(yield* answer(body, notJson)).toEqual(failure(415, 'JSON only'))

        yield* fake.failConnects(1)
        expect(yield* answer(body)).toEqual(failure(503, 'OpenCode is not reachable'))
        expect(yield* launches).toEqual([])
      }).pipe(Effect.provide(layer))

      expect(yield* fake.calls).toEqual([])
    })
  )
})

describe('POST /api/fleet/launches/:id/dismiss', () => {
  it.effect('200 dismisses a failed launch; 404 unknown; 409 still running', () =>
    Effect.gen(function* () {
      const { layer } = yield* setUp({
        createWorktree: ({ name }) =>
          name === 'feat--fails'
            ? Effect.fail(
                new OpenCodeRejectedError({ operation: 'worktree.create', message: 'refused' })
              )
            : Effect.as(Effect.sleep('2 minutes'), `/worktrees/${name}`)
      })

      const start = (branch: string) =>
        Effect.map(
          Effect.flatMap(Launches, registry =>
            registry.start({ repoDir: repo, branch, task: 'x' })
          ),
          launch => launch.id
        )

      const answer = (id: string, headers: HeadersInit = pluginHeaders) =>
        Effect.flatMap(
          dismissLaunchResponse(post(`/api/fleet/launches/${id}/dismiss`, '{}', headers), id),
          read
        )

      yield* Effect.gen(function* () {
        const failed = yield* start('feat/fails')
        const running = yield* start('feat/runs')

        yield* settle

        expect(yield* answer(running)).toEqual(failure(409, 'The launch is still running'))
        expect(yield* answer(failed, crossSite)).toEqual(failure(403, 'Request rejected'))
        expect(yield* answer(failed, notJson)).toEqual(failure(415, 'JSON only'))
        expect(yield* answer(failed)).toEqual(ok({ launchID: failed }))
        expect(yield* answer(failed)).toEqual(failure(404, 'That launch is gone'))
        expect(yield* answer('')).toEqual(failure(400, 'Invalid input'))
        expect((yield* launches).map(launch => launch.id)).toEqual([running])
      }).pipe(Effect.provide(layer))
    })
  )
})

describe('POST /api/fleet/checkouts/open', () => {
  it.effect("200: the checkout's latest session, else a new empty one", () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const open = (directory: string) =>
        Effect.flatMap(
          openCheckoutResponse(post('/api/fleet/checkouts/open', JSON.stringify({ directory }))),
          read
        )

      yield* Effect.gen(function* () {
        expect(yield* open(featX)).toEqual(ok({ sessionID: 'ses_finished', created: false }))
        expect(yield* open(fleetPi)).toEqual(ok({ sessionID: 'ses_created_1', created: true }))
      }).pipe(Effect.provide(layer))

      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([
        { op: 'createSession', directory: fleetPi, title: undefined }
      ])
    })
  )

  it.effect('400 invalid or not a checkout, 403, 415, 503', () =>
    Effect.gen(function* () {
      const { fake, layer } = yield* setUp()

      const answer = (text: string, headers: HeadersInit = pluginHeaders) =>
        Effect.flatMap(openCheckoutResponse(post('/api/fleet/checkouts/open', text, headers)), read)

      const body = JSON.stringify({ directory: fleetPi })

      yield* Effect.gen(function* () {
        expect(yield* answer(JSON.stringify({ directory: 'fleet' }))).toEqual(
          failure(400, 'Invalid input')
        )
        expect(yield* answer(JSON.stringify({ directory: '/tmp/elsewhere' }))).toEqual(
          failure(400, 'Not a git checkout on Box')
        )
        expect(yield* answer(body, crossSite)).toEqual(failure(403, 'Request rejected'))
        expect(yield* answer(body, notJson)).toEqual(failure(415, 'JSON only'))

        yield* fake.failConnects(1)
        expect(yield* answer(body)).toEqual(failure(503, 'OpenCode is not reachable'))
      }).pipe(Effect.provide(layer))

      expect((yield* fake.calls).filter(call => call.op === 'createSession')).toEqual([])
    })
  )
})

describe('failure statuses', () => {
  it('maps every expected failure to a status with the server actions’ message', () => {
    const cases: ReadonlyArray<readonly [FleetActionError, number, string]> = [
      [new CrossSiteRequestError({ message: 'x' }), 403, 'Request rejected'],
      [
        new OpenCodeInvalidInputError({ field: 'branch', message: 'No exact worktree name' }),
        400,
        'No exact worktree name'
      ],
      [new NotACheckoutError({ directory: '/x' }), 400, 'Not a git checkout on Box'],
      [new SessionNotFoundError({ sessionID: 'ses_1' }), 404, 'Session not found'],
      [new LaunchNotFoundError({ id: 'l' }), 404, 'That launch is gone'],
      [
        new SessionNotFinishedError({ sessionID: 'ses_1', state: 'working' }),
        409,
        'Only a finished session can be marked handled'
      ],
      [
        new SessionFolderGoneError({ sessionID: 'ses_1', directory: '/x' }),
        409,
        "The session's folder no longer exists"
      ],
      [new LaunchInProgressError({ id: 'l' }), 409, 'The launch is still running'],
      [new RetireRefusedError({ directory: '/x', reason: 'Busy' }), 409, 'Busy'],
      [
        new OpenCodeRejectedError({ operation: 'location.get', message: 'Not a repo' }),
        409,
        'Not a repo'
      ],
      [
        new OpenCodeRequestError({ operation: 'session.update', message: 'HTTP 500' }),
        502,
        'OpenCode could not save the handled marker'
      ],
      [new OpenCodeUnavailableError({ message: 'x' }), 503, 'OpenCode is not reachable']
    ]

    expect(cases.map(([error]) => [failureStatus(error), failureMessage(error)])).toEqual(
      cases.map(([, status, message]) => [status, message])
    )
    expect(Schema.is(ApiFailure)({ error: 'JSON only' })).toBe(true)
  })
})
