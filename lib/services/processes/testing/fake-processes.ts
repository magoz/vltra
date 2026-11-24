import { Effect, Layer, Ref } from 'effect'
import { Processes } from '@/lib/services/processes/service'
import type { ProcessTree } from '@/lib/services/processes/service'

export type FakeProcesses = {
  readonly layer: Layer.Layer<Processes>
  /** The ports a process tree listens on from now on (none: not listening). */
  readonly listen: (pid: number, ports: ReadonlyArray<number>) => Effect.Effect<void>
  /** A test runner runs in the process tree from now on. */
  readonly runTests: (pid: number) => Effect.Effect<void>
  /** Every set of process ids inspected so far, one entry per call. */
  readonly checks: Effect.Effect<ReadonlyArray<ReadonlyArray<number>>>
}

const idle: ProcessTree = { ports: [], runsTests: false }

/** In-memory processes: nothing listens or tests unless told to. */
export const makeFakeProcesses = Effect.gen(function* () {
  const trees = yield* Ref.make<ReadonlyMap<number, ProcessTree>>(new Map())
  const checks = yield* Ref.make<ReadonlyArray<ReadonlyArray<number>>>([])

  const update = (pid: number, change: (tree: ProcessTree) => ProcessTree) =>
    Ref.update(trees, map => new Map(map).set(pid, change(map.get(pid) ?? idle)))

  const layer = Layer.succeed(Processes, {
    inspect: pids =>
      Effect.gen(function* () {
        const distinct = Array.from(new Set(pids))

        yield* Ref.update(checks, list => [...list, distinct])

        const current = yield* Ref.get(trees)

        return new Map(distinct.map(pid => [pid, current.get(pid) ?? idle] as const))
      })
  })

  const fake: FakeProcesses = {
    layer,
    listen: (pid, ports) => update(pid, tree => ({ ...tree, ports })),
    runTests: pid => update(pid, tree => ({ ...tree, runsTests: true })),
    checks: Ref.get(checks)
  }

  return fake
})
