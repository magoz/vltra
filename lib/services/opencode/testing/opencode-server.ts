import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Predicate, Schedule } from 'effect'

// A throwaway `opencode serve` for integration tests. Every piece of state is isolated under one
// temp directory (HOME, XDG_*, TMPDIR, OPENCODE_CONFIG_DIR, cwd), the environment is rebuilt from
// scratch so no provider credentials leak in, and outbound HTTP(S) goes to a dead proxy so no
// model can ever be called. It never touches ~/.local/share/opencode or the live service.

export const requiredVersion = '2.0.22'

/** A JSON request body or fixture. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type OpenCodeBinary =
  | { readonly available: true; readonly path: string }
  | { readonly available: false; readonly reason: string }

const resolveBinary = (): string | undefined => {
  const override = process.env.OPENCODE_BIN

  if (override !== undefined && override !== '') return override

  const found = spawnSync('sh', ['-c', 'command -v opencode'], { encoding: 'utf8' })
  const binary = found.stdout.trim()

  return found.status === 0 && binary !== '' ? binary : undefined
}

export const findOpenCode = (): OpenCodeBinary => {
  const binary = resolveBinary()

  if (binary === undefined) {
    return { available: false, reason: 'the `opencode` binary is not on PATH (set OPENCODE_BIN)' }
  }

  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 20_000 })

  if (version.status !== 0) {
    return { available: false, reason: `\`${binary} --version\` failed` }
  }

  if (!version.stdout.includes(requiredVersion)) {
    return {
      available: false,
      reason: `Fleet pins OpenCode ${requiredVersion}; found ${version.stdout.trim()}`
    }
  }

  return { available: true, path: binary }
}

const freePort = () =>
  Effect.callback<number>(resume => {
    const server = createServer()

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address === null || Predicate.isString(address) ? 0 : address.port

      server.close(() => resume(Effect.succeed(port)))
    })
  })

export type OpenCodeServer = {
  readonly url: string
  readonly password: string
  /** Isolated working directory sessions are created in. */
  readonly workDirectory: string
  /** Authenticated JSON request against the server (test setup only). */
  readonly request: (method: string, pathname: string, body?: JsonValue) => Effect.Effect<Response>
  readonly json: <A>(method: string, pathname: string, body?: JsonValue) => Effect.Effect<A>
  /** SIGTERM the server and wait for it to exit. */
  readonly stop: Effect.Effect<void>
  /** Start it again on the same port, password and state. */
  readonly start: Effect.Effect<void>
  readonly logs: () => string
}

const waitForExit = (child: ChildProcess) =>
  Effect.callback<void>(resume => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void)

      return
    }

    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)

    child.once('exit', () => {
      clearTimeout(timer)
      resume(Effect.void)
    })

    child.kill('SIGTERM')
  })

export type OpenCodeServerOptions = {
  /** `OPENCODE_CONFIG_CONTENT` (default `{}`), e.g. an unavailable default model. */
  readonly config?: { readonly [key: string]: JsonValue }
}

/** Starts an isolated server for the current scope; stops it and deletes its state after. */
export const startOpenCodeServer = (binary: string, options: OpenCodeServerOptions = {}) =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(path.join(tmpdir(), 'fleet-opencode-it-'))),
      directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
    )

    const dirs = Object.fromEntries(
      ['home', 'data', 'state', 'config', 'cache', 'tmp', 'work'].map(name => {
        const directory = path.join(root, name)

        mkdirSync(directory, { recursive: true })

        return [name, directory]
      })
    )

    const port = yield* freePort()
    const password = randomBytes(18).toString('base64url')
    const url = `http://127.0.0.1:${port}`
    const output: Array<string> = []

    let child: ChildProcess | undefined

    const env = {
      NODE_ENV: 'test' as const,
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: dirs.home ?? root,
      TMPDIR: dirs.tmp ?? root,
      XDG_DATA_HOME: dirs.data ?? root,
      XDG_STATE_HOME: dirs.state ?? root,
      XDG_CONFIG_HOME: dirs.config ?? root,
      XDG_CACHE_HOME: dirs.cache ?? root,
      OPENCODE_CONFIG_DIR: path.join(dirs.config ?? root, 'opencode'),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_PASSWORD: password,
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost'
    }

    const authorization = `Basic ${btoa(`opencode:${password}`)}`

    const request = (method: string, pathname: string, body?: JsonValue) =>
      Effect.promise(() => {
        const init: RequestInit = {
          method,
          headers: { authorization, 'content-type': 'application/json' }
        }

        if (body !== undefined) init.body = JSON.stringify(body)

        return fetch(new URL(pathname, url), init)
      })

    const json = <A>(method: string, pathname: string, body?: JsonValue) =>
      Effect.flatMap(request(method, pathname, body), response =>
        Effect.promise((): Promise<A> => response.json())
      )

    const healthy = Effect.promise(() =>
      fetch(new URL('/api/info', url), { headers: { authorization } }).then(
        response => response.ok,
        () => false
      )
    )

    const start = Effect.gen(function* () {
      const spawned = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: dirs.work,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      spawned.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()))
      spawned.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()))
      child = spawned

      yield* healthy.pipe(
        Effect.repeat({ until: ok => ok, schedule: Schedule.spaced('100 millis') }),
        Effect.timeoutOrElse({
          duration: '30 seconds',
          orElse: () => Effect.die(new Error(`opencode serve did not start:\n${output.join('')}`))
        })
      )
    })

    const stop = Effect.suspend(() => (child === undefined ? Effect.void : waitForExit(child)))

    yield* Effect.acquireRelease(start, () => stop)

    const server: OpenCodeServer = {
      url,
      password,
      workDirectory: dirs.work ?? root,
      request,
      json,
      stop,
      start,
      logs: () => output.join('')
    }

    return server
  })
