import { Effect, Layer, Ref } from 'effect'
import { Directories } from '@/lib/services/directories/service'

export type FakeDirectories = {
  readonly layer: Layer.Layer<Directories>
  /** Delete a directory: later checks report it gone. */
  readonly remove: (directory: string) => Effect.Effect<void>
  /** Recreate a directory. */
  readonly restore: (directory: string) => Effect.Effect<void>
  /** Every directory checked so far, one entry per check call. */
  readonly checks: Effect.Effect<ReadonlyArray<ReadonlyArray<string>>>
}

/** In-memory directories: everything exists unless it was removed. */
export const makeFakeDirectories = (gone: Iterable<string> = []) =>
  Effect.gen(function* () {
    const removed = yield* Ref.make<ReadonlySet<string>>(new Set(gone))
    const checks = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([])

    const layer = Layer.succeed(Directories, {
      check: directories =>
        Effect.gen(function* () {
          const distinct = Array.from(new Set(directories))

          yield* Ref.update(checks, list => [...list, distinct])

          const current = yield* Ref.get(removed)

          return new Map(distinct.map(directory => [directory, current.has(directory)] as const))
        })
    })

    const fake: FakeDirectories = {
      layer,
      remove: directory => Ref.update(removed, set => new Set(set).add(directory)),
      restore: directory =>
        Ref.update(removed, set => new Set(Array.from(set).filter(item => item !== directory))),
      checks: Ref.get(checks)
    }

    return fake
  })

/** Every directory exists. */
export const presentDirectories = Layer.succeed(Directories, {
  check: directories =>
    Effect.succeed(new Map(Array.from(directories, directory => [directory, false] as const)))
})
