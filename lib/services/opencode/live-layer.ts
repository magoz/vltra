import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient'
import {
  AbsolutePath,
  Model,
  OpenCode as OpenCodeApi,
  Project,
  Session
} from '@opencode/client/effect'
import type { OpenCodeClient } from '@opencode/client/effect'
import { Service } from '@opencode/client/effect/service'
import type { Endpoint } from '@opencode/client/effect/service'
import { Data, DateTime, Duration, Effect, Layer, Option, Predicate, Schema, Stream } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http'
import type { OpenCodeSnapshot } from '@/lib/data/fleet/model'
import type { PendingForm, PendingPermission, SessionRecord } from '@/lib/data/fleet/types'
import {
  branchModel,
  endpointOverride,
  serviceFile,
  sessionLimit
} from '@/lib/services/opencode/config'
import {
  OpenCodeInvalidInputError,
  OpenCodeRejectedError,
  OpenCodeRequestError,
  OpenCodeUnavailableError,
  SessionNotFoundError
} from '@/lib/services/opencode/errors'
import {
  latestRunEnd,
  refusalMessage,
  toPendingForm,
  toPendingPermission,
  toProjectRecord,
  toFileChange,
  toResolvedLocation,
  toSessionRecord,
  toSignals,
  toTranscript,
  withFleetHandled
} from '@/lib/services/opencode/mapping'
import type { RunEnd } from '@/lib/services/opencode/mapping'
import { OpenCode } from '@/lib/services/opencode/service'
import type { OpenCodeConnection } from '@/lib/services/opencode/service'

const requestTimeout = Duration.seconds(15)

const pageSize = 100

const concurrency = 4

/** Most transcript entries (messages, tool calls, ...) returned for one session. */
const transcriptEntries = 60

/** A long session's whole durable log can take a while to replay. */
const logTimeout = Duration.seconds(60)

/**
 * `worktree.create` answers once the checkout is provisioned: the dotfiles plugin bounds its CLI
 * at 30 minutes, so Fleet waits a little longer.
 */
const createWorktreeTimeout = Duration.minutes(35)

/** `worktree.remove`: the plugin bounds planning and retirement at 5 + 15 minutes. */
const removeWorktreeTimeout = Duration.minutes(21)

const errorMessage = (cause: unknown) => (Predicate.isError(cause) ? cause.message : String(cause))

const request =
  (operation: string) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, OpenCodeRequestError> =>
    effect.pipe(
      Effect.timeout(requestTimeout),
      Effect.mapError(
        cause => new OpenCodeRequestError({ operation, message: errorMessage(cause), cause })
      )
    )

const decodeId =
  <S extends Schema.Codec<unknown, string>>(schema: S, field: string) =>
  (value: string) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(() => new OpenCodeInvalidInputError({ field, message: `Invalid ${field}` }))
    )

const decodeSessionId = decodeId(Session.ID, 'sessionID')

const decodeProjectId = decodeId(Project.ID, 'projectID')

const decodeDirectory = decodeId(AbsolutePath, 'directory')

/** Calls OpenCode may refuse with its own message: that message, else a request error. */
const refusable =
  (operation: string, timeout: Duration.Duration = requestTimeout) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.timeout(timeout),
      Effect.mapError(cause =>
        Option.match(refusalMessage(cause), {
          onSome: message => new OpenCodeRejectedError({ operation, message }),
          onNone: () => new OpenCodeRequestError({ operation, message: errorMessage(cause), cause })
        })
      )
    )

/** Maps OpenCode's typed not-found error to Fleet's, everything else to a request error. */
const action =
  (operation: string, sessionID: string) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.timeout(requestTimeout),
      Effect.mapError(cause =>
        Predicate.isTagged(cause, 'SessionNotFoundError')
          ? new SessionNotFoundError({ sessionID })
          : new OpenCodeRequestError({ operation, message: errorMessage(cause), cause })
      )
    )

type EndpointSource =
  | { readonly _tag: 'Override'; readonly endpoint: Endpoint }
  | { readonly _tag: 'Discover'; readonly file: Option.Option<string> }

const EndpointSource = Data.taggedEnum<EndpointSource>()

/**
 * Config is read once, when the layer is built, so every later `connect` (watcher cycles and
 * actions, whatever fiber runs them) uses the same source and can never silently fall back to
 * discovering a different service.
 */
const endpointSource = Effect.gen(function* () {
  const override = yield* endpointOverride

  if (Option.isSome(override)) return EndpointSource.Override({ endpoint: override.value })

  return EndpointSource.Discover({ file: yield* serviceFile })
})

const resolveEndpoint = (source: EndpointSource) =>
  EndpointSource.$match(source, {
    Override: ({ endpoint }) => Effect.succeed(endpoint),
    Discover: ({ file }) =>
      Effect.gen(function* () {
        // Read-only discovery: registration file + health check. Never `Service.ensure`, which
        // can spawn a server; systemd owns opencode.service.
        const found = yield* Service.discover(
          Option.match(file, { onNone: () => ({}), onSome: path => ({ file: path }) })
        ).pipe(Effect.provide(NodeFileSystem.layer))

        if (found === undefined) {
          return yield* new OpenCodeUnavailableError({
            message: 'No running OpenCode service was discovered'
          })
        }

        const endpoint: Endpoint =
          found.auth === undefined ? { url: found.url } : { url: found.url, auth: found.auth }

        return endpoint
      })
  })

const makeSessionReader = (client: OpenCodeClient) => (sessionID: string) =>
  decodeSessionId(sessionID).pipe(
    Effect.flatMap(id =>
      client.session.get({ sessionID: id }).pipe(
        Effect.map(info => Option.some(toSessionRecord(info))),
        Effect.catchTag('SessionNotFoundError', () => Effect.succeed(Option.none<SessionRecord>()))
      )
    ),
    Effect.catchTag('OpenCodeInvalidInputError', () =>
      Effect.succeed(Option.none<SessionRecord>())
    ),
    request('session.get')
  )

const makeSnapshot = (
  client: OpenCodeClient,
  limit: Option.Option<number>,
  readSession: (
    sessionID: string
  ) => Effect.Effect<Option.Option<SessionRecord>, OpenCodeRequestError>
) =>
  Effect.gen(function* () {
    const sessions = new Map<string, SessionRecord>()

    // No cap by default: page through every session.
    const firstPage = Option.match(limit, {
      onNone: () => pageSize,
      onSome: max => Math.min(pageSize, max)
    })

    const full = (count: number) => Option.exists(limit, max => count >= max)

    let next = yield* client.session.list({ limit: firstPage }).pipe(request('session.list'))

    for (;;) {
      for (const info of next.data) sessions.set(info.id, toSessionRecord(info))

      if (next.data.length < firstPage || full(sessions.size)) break

      const nextCursor = next.cursor.next

      if (nextCursor === undefined) break

      next = yield* client.session
        .list({ cursor: nextCursor, limit: pageSize })
        .pipe(request('session.list'))
    }

    const loadMissing = (ids: Iterable<string>) =>
      Effect.forEach(
        Array.from(new Set(ids)).filter(id => !sessions.has(id)),
        id =>
          readSession(id).pipe(
            Effect.map(found => {
              if (Option.isSome(found)) sessions.set(found.value.id, found.value)
            })
          ),
        { concurrency, discard: true }
      )

    const active = yield* client.session.active().pipe(request('session.active'))
    const running = Object.keys(active)

    yield* loadMissing(running)

    // Pending permissions and forms live per location; list them for every loaded location
    // (plus running sessions' directories, in case the debug listing is unavailable).
    const loaded = yield* client.debug.location.list().pipe(
      request('debug.location.list'),
      Effect.tapError(error => Effect.logWarning('Loaded locations unavailable', error.message)),
      Effect.orElseSucceed(() => [])
    )

    const directories = new Set([
      ...loaded.map(location => location.directory),
      ...running.flatMap(id => {
        const directory = sessions.get(id)?.directory

        return directory === undefined ? [] : [directory]
      })
    ])

    const pending = yield* Effect.forEach(
      directories,
      directory =>
        Effect.all(
          [
            client.permission.request.list({ location: { directory } }).pipe(
              request('permission.request.list'),
              Effect.map(response => response.data.map(toPendingPermission))
            ),
            client.form.list({ location: { directory } }).pipe(
              request('form.list'),
              Effect.map(response => response.data.map(toPendingForm))
            )
          ],
          { concurrency: 2 }
        ).pipe(
          Effect.tapError(error =>
            Effect.logWarning('Pending requests unavailable for location', directory, error.message)
          ),
          Effect.orElseSucceed(
            (): readonly [ReadonlyArray<PendingPermission>, ReadonlyArray<PendingForm>] => [[], []]
          )
        ),
      { concurrency }
    )

    const permissions = new Map(pending.flatMap(([items]) => items.map(item => [item.id, item])))
    const forms = new Map(pending.flatMap(([, items]) => items.map(item => [item.id, item])))

    yield* loadMissing([
      ...Array.from(permissions.values(), item => item.sessionID),
      ...Array.from(forms.values(), item => item.sessionID)
    ])

    // Load ancestors so subagent sessions nest under their root.
    for (let depth = 0; depth < 4; depth += 1) {
      const missing = Array.from(sessions.values()).flatMap(session =>
        session.parentID !== undefined && !sessions.has(session.parentID) ? [session.parentID] : []
      )

      if (missing.length === 0) break

      yield* loadMissing(missing)
    }

    const projects = yield* client.project.list().pipe(request('project.list'))
    const projectIds = new Set(Array.from(sessions.values(), session => session.projectID))

    const worktrees = yield* Effect.forEach(
      projects.filter(project => projectIds.has(project.id)),
      project =>
        client.worktree.list({ projectID: project.id }).pipe(
          request('worktree.list'),
          Effect.map(list => ({
            projectID: project.id,
            directories: list.map(entry => entry.directory)
          })),
          Effect.orElseSucceed(() => ({ projectID: project.id, directories: [] }))
        ),
      { concurrency }
    )

    return {
      sessions: Array.from(sessions.values()),
      running,
      permissions: Array.from(permissions.values()),
      forms: Array.from(forms.values()),
      projects: projects.map(toProjectRecord),
      worktrees
    } satisfies OpenCodeSnapshot
  })

/** `provider/model` (the model id may itself contain `/`) as OpenCode's model ref, if valid. */
const decodeModelRef = (value: string) => {
  const slash = value.indexOf('/')

  if (slash <= 0 || slash === value.length - 1) return Option.none()

  return Schema.decodeUnknownOption(Model.Ref)({
    providerID: value.slice(0, slash),
    id: value.slice(slash + 1)
  })
}

const makeConnection = (
  endpoint: Endpoint,
  limit: Option.Option<number>,
  http: HttpClient.HttpClient,
  longHttp: HttpClient.HttpClient,
  suggestionModel: string
) =>
  Effect.gen(function* () {
    const headers = Service.headers(endpoint)

    const authorize = (base: HttpClient.HttpClient) =>
      headers === undefined
        ? base
        : HttpClient.mapRequest(base, HttpClientRequest.setHeaders(headers))

    const client = yield* OpenCodeApi.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(HttpClient.HttpClient, authorize(http))
    )

    // Worktree calls can take many minutes; `fetch` (undici's defaults) gives up on a response's
    // headers after 5. This client leaves time limits to `Effect.timeout`.
    const longClient = yield* OpenCodeApi.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(HttpClient.HttpClient, authorize(longHttp))
    )

    const info = yield* client.server.info().pipe(request('server.info'))
    const readSession = makeSessionReader(client)

    return {
      url: endpoint.url,
      version: info.version,
      signals: client.event.subscribe().pipe(
        Stream.mapError(
          cause =>
            new OpenCodeRequestError({
              operation: 'event.subscribe',
              message: errorMessage(cause),
              cause
            })
        ),
        Stream.flatMap(event => Stream.fromIterable(toSignals(event)))
      ),
      snapshot: makeSnapshot(client, limit, readSession),
      session: readSession,
      worktrees: projectID =>
        decodeProjectId(projectID).pipe(
          Effect.flatMap(id => client.worktree.list({ projectID: id })),
          Effect.map(list => list.map(entry => entry.directory)),
          request('worktree.list')
        ),
      setHandled: ({ sessionID, handled }) =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          // Read-modify-write: `session.update` replaces the whole metadata object.
          const info = yield* client.session
            .get({ sessionID: id })
            .pipe(action('session.get', sessionID))

          yield* client.session
            .update({ sessionID: id, metadata: withFleetHandled(info.metadata, handled) })
            .pipe(action('session.update', sessionID))
        }),
      interruptReason: sessionID =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          // `follow: false` replays the durable log and ends after its `log.synced` marker.
          const end = yield* client.session.log({ sessionID: id, follow: false }).pipe(
            Stream.takeUntil(item => item.type === 'log.synced'),
            Stream.runFold((): RunEnd | undefined => undefined, latestRunEnd),
            Effect.timeout(logTimeout),
            Effect.mapError(cause =>
              Predicate.isTagged(cause, 'SessionNotFoundError')
                ? new SessionNotFoundError({ sessionID })
                : new OpenCodeRequestError({
                    operation: 'session.log',
                    message: errorMessage(cause),
                    cause
                  })
            )
          )

          return end?.outcome === 'interrupted' ? Option.fromNullishOr(end.reason) : Option.none()
        }),
      view: ({ sessionID, idle }) =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          const at = yield* Option.match(DateTime.make(idle), {
            onNone: () =>
              Effect.fail(
                new OpenCodeInvalidInputError({ field: 'idle', message: 'Invalid idle' })
              ),
            onSome: value => Effect.succeed(DateTime.toUtc(value))
          })

          yield* client.session
            .view({ sessionID: id, idle: at })
            .pipe(action('session.view', sessionID))
        }),
      prompt: ({ sessionID, text }) =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          yield* client.session
            .prompt({ sessionID: id, text })
            .pipe(action('session.prompt', sessionID))
        }),
      transcript: ({ sessionID, limit, assistantOnly }) =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          const page = yield* client.message
            .list({
              sessionID: id,
              limit,
              order: 'desc',
              type: assistantOnly ? 'assistant' : undefined
            })
            .pipe(action('message.list', sessionID))

          // One page is enough: it holds the newest messages, and entries are clipped.
          return toTranscript(page.data, transcriptEntries)
        }),
      diff: ({ sessionID }) =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          // `context: 0` keeps the (unused) patches small.
          const files = yield* client.session
            .diff({ sessionID: id, context: 0 })
            .pipe(action('session.diff', sessionID))

          return files.map(toFileChange)
        }),
      resolveLocation: directory =>
        Effect.gen(function* () {
          const path = yield* decodeDirectory(directory)

          const info = yield* client.location
            .get({ location: { directory: path } })
            .pipe(refusable('location.get'))

          return toResolvedLocation(info)
        }),
      createWorktree: ({ projectID, name }) =>
        Effect.gen(function* () {
          const id = yield* decodeProjectId(projectID)

          const created = yield* longClient.worktree
            .create({ projectID: id, name })
            .pipe(refusable('worktree.create', createWorktreeTimeout))

          return created.directory
        }),
      removeWorktree: ({ projectID, directory }) =>
        Effect.gen(function* () {
          const id = yield* decodeProjectId(projectID)
          const path = yield* decodeDirectory(directory)

          yield* longClient.worktree
            .remove({ projectID: id, directory: path, force: false })
            .pipe(refusable('worktree.remove', removeWorktreeTimeout))
        }),
      removeSession: sessionID =>
        Effect.gen(function* () {
          const id = yield* decodeSessionId(sessionID)

          yield* client.session.remove({ sessionID: id }).pipe(
            Effect.catchTag('SessionNotFoundError', () => Effect.void),
            refusable('session.remove')
          )
        }),
      createSession: ({ directory, title }) =>
        Effect.gen(function* () {
          const path = yield* decodeDirectory(directory)

          const info = yield* client.session
            .create({ title, location: { directory: path } })
            .pipe(refusable('session.create'))

          return toSessionRecord(info)
        }),
      generateText: prompt =>
        client.generate
          .text({ prompt, model: Option.getOrUndefined(decodeModelRef(suggestionModel)) })
          .pipe(
            refusable('generate.text'),
            Effect.map(output => output.text)
          )
    } satisfies OpenCodeConnection
  })

export const OpenCodeLive = Layer.effect(
  OpenCode,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    // Its own undici agent, closed with the layer (the runtime).
    const dispatcher = yield* NodeHttpClient.makeDispatcher

    const longHttp = yield* NodeHttpClient.makeUndici.pipe(
      Effect.provideService(NodeHttpClient.Dispatcher, dispatcher)
    )

    const source = yield* endpointSource
    const limit = yield* sessionLimit
    const suggestionModel = yield* branchModel

    return {
      connect: Effect.flatMap(resolveEndpoint(source), endpoint =>
        makeConnection(endpoint, limit, http, longHttp, suggestionModel)
      )
    }
  }).pipe(
    Effect.mapError(
      error => new OpenCodeUnavailableError({ message: `Invalid configuration: ${error.message}` })
    )
  )
).pipe(Layer.provide(FetchHttpClient.layer))
