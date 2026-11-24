import { spawn } from 'node:child_process'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { listeningSockets, ProcessesLive } from '@/lib/services/processes/live-layer'
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

const isLinux = process.platform === 'linux'

describe.skipIf(!isLinux)('ProcessesLive (this machine)', () => {
  it.effect('finds the port a child of the process listens on', () =>
    Effect.gen(function* () {
      // A shell whose child listens, as `pnpm dev` under OpenCode's shell does.
      const child = spawn(
        'sh',
        [
          '-c',
          `${process.execPath} -e "require('net').createServer().listen(0, '127.0.0.1', () => console.log('up'))"`
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      )

      yield* Effect.addFinalizer(() => Effect.sync(() => child.kill('SIGKILL')))

      yield* Effect.callback<void>(resume => {
        child.stdout.once('data', () => resume(Effect.void))
      })

      const pid = child.pid ?? 0
      const processes = yield* Processes
      const found = yield* processes.listening([pid])

      expect(found.get(pid)?.length).toBe(1)
    }).pipe(Effect.provide(ProcessesLive), Effect.scoped)
  )

  it.effect('a process that does not listen, or is gone, has no ports', () =>
    Effect.gen(function* () {
      const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' })

      yield* Effect.addFinalizer(() => Effect.sync(() => sleeper.kill('SIGKILL')))

      const pid = sleeper.pid ?? 0
      const missing = 2 ** 22 + 7
      const processes = yield* Processes
      const found = yield* processes.listening([pid, missing])

      expect(found.get(pid)).toEqual([])
      expect(found.get(missing)).toEqual([])
    }).pipe(Effect.provide(ProcessesLive), Effect.scoped)
  )
})
