import { request } from 'node:http'
import { Config, Duration, Effect, Option, Schema } from 'effect'
import {
  WatcherRefusedError,
  WatcherRun,
  WatcherUnavailableError
} from '@/lib/services/watcher/service'
import type { LaunchRequest, WatcherOperations } from '@/lib/services/watcher/service'

/**
 * Watcher's socket (`FLEET_WATCHER_SOCKET`), else `$XDG_RUNTIME_DIR/watcher.sock`: where the daemon
 * listens by default for the same user.
 */
export const watcherSocket = Config.all({
  explicit: Config.option(Config.nonEmptyString('FLEET_WATCHER_SOCKET')),
  runtime: Config.option(Config.nonEmptyString('XDG_RUNTIME_DIR'))
}).pipe(
  Config.map(({ explicit, runtime }) =>
    Option.getOrElse(explicit, () =>
      Option.match(runtime, {
        onNone: () => `/run/user/${process.getuid?.() ?? 0}/watcher.sock`,
        onSome: directory => `${directory}/watcher.sock`
      })
    )
  )
)

const requestTimeout = Duration.seconds(15)

type Answer = { readonly status: number; readonly body: string }

/** One JSON request over the unix socket at `socketPath`. */
const call = (socketPath: string, method: 'GET' | 'POST', path: string, body?: LaunchRequest) =>
  Effect.callback<Answer, WatcherUnavailableError>(resume => {
    const payload = body === undefined ? undefined : JSON.stringify(body)

    const req = request(
      {
        socketPath,
        path,
        method,
        headers:
          payload === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
      },
      response => {
        const chunks: Array<Buffer> = []

        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resume(
            Effect.succeed({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8')
            })
          )
        )
        response.on('error', error =>
          resume(Effect.fail(new WatcherUnavailableError({ message: error.message })))
        )
      }
    )

    req.on('error', error =>
      resume(
        Effect.fail(
          new WatcherUnavailableError({
            message: `Watcher is not running (${error.message})`
          })
        )
      )
    )

    if (payload !== undefined) req.write(payload)
    req.end()

    return Effect.sync(() => req.destroy())
  }).pipe(
    Effect.timeoutOrElse({
      duration: requestTimeout,
      orElse: () => Effect.fail(new WatcherUnavailableError({ message: 'Watcher did not answer' }))
    })
  )

const decodeRun = Schema.decodeUnknownEffect(Schema.fromJsonString(WatcherRun))

const decodeRuns = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(WatcherRun)))

const RefusalBody = Schema.fromJsonString(Schema.Struct({ message: Schema.String }))

const decodeRefusal = Schema.decodeUnknownOption(RefusalBody)

const unreadable = (what: string) => () =>
  new WatcherUnavailableError({ message: `Watcher answered an unreadable ${what}` })

/** The client for the daemon at `socketPath`. */
export const makeWatcher = (socketPath: string): WatcherOperations => ({
  launch: launchRequest =>
    Effect.gen(function* () {
      const answer = yield* call(socketPath, 'POST', '/launches', launchRequest)

      if (answer.status === 400) {
        return yield* new WatcherRefusedError({
          message: Option.match(decodeRefusal(answer.body), {
            onNone: () => 'Watcher refused the launch',
            onSome: refusal => refusal.message
          })
        })
      }

      if (answer.status !== 200) {
        return yield* new WatcherUnavailableError({ message: `Watcher answered ${answer.status}` })
      }

      return yield* decodeRun(answer.body).pipe(Effect.mapError(unreadable('launch')))
    }),
  run: id =>
    Effect.gen(function* () {
      const answer = yield* call(socketPath, 'GET', `/runs/${encodeURIComponent(id)}`)

      if (answer.status === 404) return Option.none()

      if (answer.status !== 200) {
        return yield* new WatcherUnavailableError({ message: `Watcher answered ${answer.status}` })
      }

      return Option.some(yield* decodeRun(answer.body).pipe(Effect.mapError(unreadable('run'))))
    }),
  launching: Effect.gen(function* () {
    const answer = yield* call(socketPath, 'GET', '/runs?watch=manual&status=launching&limit=100')

    if (answer.status !== 200) {
      return yield* new WatcherUnavailableError({ message: `Watcher answered ${answer.status}` })
    }

    return yield* decodeRuns(answer.body).pipe(Effect.mapError(unreadable('run list')))
  })
})
