import { Effect, Layer, Ref } from 'effect'
import { Processes } from '@/lib/services/processes/service'

export type FakeProcesses = {
  readonly layer: Layer.Layer<Processes>
  /** The ports a process tree listens on from now on (none: not listening). */
  readonly listen: (pid: number, ports: ReadonlyArray<number>) => Effect.Effect<void>
  /** Every set of process ids checked so far, one entry per call. */
  readonly checks: Effect.Effect<ReadonlyArray<ReadonlyArray<number>>>
}

/** In-memory processes: nothing listens unless told to. */
export const makeFakeProcesses = Effect.gen(function* () {
  const listening = yield* Ref.make<ReadonlyMap<number, ReadonlyArray<number>>>(new Map())
  const checks = yield* Ref.make<ReadonlyArray<ReadonlyArray<number>>>([])

  const layer = Layer.succeed(Processes, {
    listening: pids =>
      Effect.gen(function* () {
        const distinct = Array.from(new Set(pids))

        yield* Ref.update(checks, list => [...list, distinct])

        const current = yield* Ref.get(listening)

        return new Map(distinct.map(pid => [pid, current.get(pid) ?? []] as const))
      })
  })

  const fake: FakeProcesses = {
    layer,
    listen: (pid, ports) => Ref.update(listening, map => new Map(map).set(pid, ports)),
    checks: Ref.get(checks)
  }

  return fake
})
