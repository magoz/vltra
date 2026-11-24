import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { listeningSockets, ProcessesLive, runsTests } from '@/lib/services/processes/live-layer'
import { Processes } from '@/lib/services/processes/service'

// `/proc/net/tcp` as Linux writes it (trimmed): one listening socket on 127.0.0.1:4676, one
// established connection.
const table = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:1244 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 100686857 1 0 99 0 0 10 0',
  '   1: 0100007F:1244 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 100686999 1 0 20 4 30 10 -1',
  ''
].join('\n')

describe('listeningSockets', () => {
  it('reads the listening sockets: inode → port', () => {
    expect(listeningSockets(table)).toEqual(new Map([['100686857', 4676]]))
  })

  it('reads nothing from an empty or unreadable table', () => {
    expect(listeningSockets('')).toEqual(new Map())
  })
})

describe('runsTests', () => {
  it.each([
    ['node', '/repo/node_modules/vitest/vitest.mjs', 'run'],
    ['node', '/repo/node_modules/@playwright/test/cli.js', 'test'],
    ['node', '/repo/node_modules/.bin/jest'],
    ['/repo/node_modules/.bin/playwright', 'test'],
    ['node', '/repo/node_modules/cypress/bin/cypress', 'run'],
    ['pnpm', 'exec', 'vitest']
  ])('a test runner: %s %s', (...argv) => {
    expect(runsTests(argv)).toBe(true)
  })

  it.each([
    ['node', '/repo/node_modules/next/dist/bin/next', 'dev'],
    ['pnpm', 'dev'],
    ['pnpm', 'test'],
    ['node', '/repo/node_modules/vite/bin/vite.js'],
    ['node', '/repo/src/jester.js']
  ])('not a test runner: %s %s', (...argv) => {
    // `pnpm test` is only a script name; the runner it starts is its child.
    expect(runsTests(argv)).toBe(false)
  })
})

const isLinux = process.platform === 'linux'

const listen = `require('net').createServer().listen(0, '127.0.0.1', () => console.log('up'))`

/** Starts `sh -c <command>` and resolves once a process in it printed `up`. */
const shell = (command: string) =>
  Effect.gen(function* () {
    // Its own process group, so the whole tree can be killed at the end.
    const child = spawn('sh', ['-c', command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      })
    )

    yield* Effect.callback<void>(resume => {
      child.stdout.once('data', () => resume(Effect.void))
    })

    return child.pid ?? 0
  })

describe.skipIf(!isLinux)('ProcessesLive (this machine)', () => {
  it.effect('finds the port a child of the process listens on: a service', () =>
    Effect.gen(function* () {
      const pid = yield* shell(`${process.execPath} -e "${listen}"`)
      const found = (yield* (yield* Processes).inspect([pid])).get(pid)

      expect(found?.ports.length).toBe(1)
      expect(found?.runsTests).toBe(false)
    }).pipe(Effect.provide(ProcessesLive), Effect.scoped)
  )

  it.effect("a test runner's own server: listening, and testing", () =>
    Effect.gen(function* () {
      // A runner that starts the app it tests, as Playwright's `webServer` does.
      const root = mkdtempSync(path.join(tmpdir(), 'vltra-runner-'))
      const runner = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')

      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(root, { recursive: true })))

      mkdirSync(path.dirname(runner), { recursive: true })
      writeFileSync(
        runner,
        `import { spawn } from 'node:child_process'\nspawn(process.execPath, ['-e', ${JSON.stringify(listen)}], { stdio: 'inherit' })\nsetInterval(() => {}, 1000)\n`
      )

      const pid = yield* shell(`${process.execPath} ${runner}`)
      const found = (yield* (yield* Processes).inspect([pid])).get(pid)

      expect(found?.ports.length).toBe(1)
      expect(found?.runsTests).toBe(true)
    }).pipe(Effect.provide(ProcessesLive), Effect.scoped)
  )

  it.effect('a process that does not listen, or is gone, has nothing', () =>
    Effect.gen(function* () {
      const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' })

      yield* Effect.addFinalizer(() => Effect.sync(() => sleeper.kill('SIGKILL')))

      const pid = sleeper.pid ?? 0
      const missing = 2 ** 22 + 7
      const found = yield* (yield* Processes).inspect([pid, missing])

      expect(found.get(pid)).toEqual({ ports: [], runsTests: false })
      expect(found.get(missing)).toEqual({ ports: [], runsTests: false })
    }).pipe(Effect.provide(ProcessesLive), Effect.scoped)
  )
})
