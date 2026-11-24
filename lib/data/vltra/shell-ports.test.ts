import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { fromSnapshot } from '@/lib/data/vltra/model'
import type { OpenCodeSnapshot } from '@/lib/data/vltra/model'
import { checkShellPorts } from '@/lib/data/vltra/shell-ports'
import { snapshotRows } from '@/lib/data/vltra/snapshot'
import { VltraStore, makeVltraStore } from '@/lib/data/vltra/store'
import { baseTime, runningShell, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent } from '@/lib/data/vltra/model'
import { emptySnapshot, makeFakeOpenCode } from '@/lib/services/opencode/testing/fake-opencode'
import { makeFakeProcesses } from '@/lib/services/processes/testing/fake-processes'

// The port check: a shell whose process tree listens is a service, which releases its session.

const ended = sessionRecord('ses_1', { idle: baseTime, outcome: 'succeeded' })

const devServer = runningShell('sh_dev', 'ses_1', { command: 'pnpm dev', pid: 100 })

const setUp = (snapshot: OpenCodeSnapshot, model: OpenCodeSnapshot = snapshot) =>
  Effect.gen(function* () {
    const opencode = yield* makeFakeOpenCode(snapshot)
    const processes = yield* makeFakeProcesses

    const store = Layer.effect(
      VltraStore,
      Effect.gen(function* () {
        const made = yield* makeVltraStore(webUrl)

        yield* made.commit(view => ({ ...view, model: fromSnapshot(model, baseTime) }))

        return made
      })
    )

    const lookedUp = yield* Ref.make<ReadonlySet<string>>(new Set())

    return {
      opencode,
      processes,
      layer: Layer.mergeAll(store, opencode.layer, processes.layer),
      check: checkShellPorts(lookedUp)
    }
  })

const rowState = Effect.map(
  Effect.flatMap(VltraStore, store => store.snapshot),
  snapshot => snapshotRows(snapshot).find(row => row.id === 'ses_1')
)

describe('shell port check', () => {
  it.effect('a shell that starts listening releases its session (finished, serving)', () =>
    Effect.gen(function* () {
      const { processes, layer, check } = yield* setUp({
        ...emptySnapshot,
        sessions: [ended],
        shells: [devServer]
      })

      yield* Effect.gen(function* () {
        yield* check

        expect((yield* rowState)?.state).toBe('working')

        yield* processes.listen(100, [3000])
        yield* check

        const row = yield* rowState

        expect(row?.state).toBe('finished')
        expect(row?.services).toEqual([{ id: 'sh_dev', command: 'pnpm dev', ports: [3000] }])
        expect(row?.waits).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('a test run that starts its own server stays a wait (Playwright webServer)', () =>
    Effect.gen(function* () {
      const e2e = runningShell('sh_e2e', 'ses_1', { command: 'pnpm test:e2e', pid: 300 })

      const { processes, layer, check } = yield* setUp({
        ...emptySnapshot,
        sessions: [ended],
        shells: [e2e]
      })

      yield* processes.listen(300, [3000])
      yield* processes.runTests(300)

      yield* Effect.gen(function* () {
        yield* check

        const row = yield* rowState

        expect(row?.state).toBe('working')
        expect(row?.services).toEqual([])
        expect(row?.waits).toMatchObject([{ kind: 'script', id: 'sh_e2e' }])
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('commits nothing while the ports stay the same', () =>
    Effect.gen(function* () {
      const { processes, layer, check } = yield* setUp({
        ...emptySnapshot,
        sessions: [ended],
        shells: [devServer]
      })

      yield* processes.listen(100, [3000])

      yield* Effect.gen(function* () {
        const store = yield* VltraStore

        yield* check

        const first = yield* store.view

        yield* check

        expect(yield* store.view).toBe(first)
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect('looks up the process id an event left out, once, only after the run has ended', () =>
    Effect.gen(function* () {
      // OpenCode's stored shell has the pid; the model (from `shell.created`) does not.
      const stored: OpenCodeSnapshot = { ...emptySnapshot, sessions: [ended], shells: [devServer] }

      const { opencode, processes, layer, check } = yield* setUp(stored, {
        ...stored,
        sessions: [ended, sessionRecord('ses_busy')],
        running: ['ses_busy'],
        shells: [
          { ...devServer, pid: undefined },
          runningShell('sh_busy', 'ses_busy', { pid: undefined })
        ]
      })

      yield* processes.listen(100, [5173])

      yield* Effect.gen(function* () {
        yield* check
        yield* check

        expect((yield* rowState)?.state).toBe('finished')

        const store = yield* VltraStore

        expect((yield* store.view).model.shells.get('sh_dev')?.pid).toBe(100)
      }).pipe(Effect.provide(layer))

      // The busy session's shell is not looked up; the ended one once.
      expect((yield* opencode.calls).filter(call => call.op === 'shellPid')).toEqual([
        { op: 'shellPid', shellID: 'sh_dev', directory: ended.directory }
      ])
    })
  )

  it.effect('a script that ends after being checked leaves no ports behind', () =>
    Effect.gen(function* () {
      const { layer, check } = yield* setUp({
        ...emptySnapshot,
        sessions: [ended],
        shells: [runningShell('sh_test', 'ses_1', { pid: 200 })]
      })

      yield* Effect.gen(function* () {
        yield* check

        const store = yield* VltraStore

        yield* store.commit(view => ({
          ...view,
          model: applyEvent(view.model, VltraEvent.ShellEnded({ shellID: 'sh_test' }))
        }))

        expect((yield* store.view).model.shellPorts.size).toBe(0)
        expect((yield* rowState)?.state).toBe('finished')
      }).pipe(Effect.provide(layer))
    })
  )
})
