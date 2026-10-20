import { Effect, Layer, Option, Ref } from 'effect'
import { GitHub, GitHubUnavailableError } from '@/lib/services/github/service'
import type { MergedPull, MergeWindow } from '@/lib/services/github/service'

export type FakeGitHubCall = { readonly op: 'merged' | 'mergedCount' } & MergeWindow

export type FakeGitHub = {
  readonly layer: Layer.Layer<GitHub>
  readonly setPulls: (pulls: ReadonlyArray<MergedPull>) => Effect.Effect<void>
  /** Every call fails with this message from now on (none: answers again). */
  readonly setFailure: (message: string | undefined) => Effect.Effect<void>
  readonly calls: Effect.Effect<ReadonlyArray<FakeGitHubCall>>
}

const inWindow = (pulls: ReadonlyArray<MergedPull>, { from, to }: MergeWindow) =>
  pulls.filter(pull => pull.mergedAt >= from && pull.mergedAt < to)

/** In-memory merged pull requests: `merged` and `mergedCount` answer from them and record calls. */
export const makeFakeGitHub = (initial: ReadonlyArray<MergedPull> = []) =>
  Effect.gen(function* () {
    const pulls = yield* Ref.make(initial)
    const failure = yield* Ref.make(Option.none<string>())
    const calls = yield* Ref.make<ReadonlyArray<FakeGitHubCall>>([])

    const answer = <A>(call: FakeGitHubCall, read: (list: ReadonlyArray<MergedPull>) => A) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, list => [...list, call])

        const failing = yield* Ref.get(failure)

        if (Option.isSome(failing)) {
          return yield* new GitHubUnavailableError({ message: failing.value })
        }

        return read(inWindow(yield* Ref.get(pulls), call))
      })

    const layer = Layer.succeed(GitHub, {
      merged: window => answer({ op: 'merged', ...window }, list => list),
      mergedCount: window => answer({ op: 'mergedCount', ...window }, list => list.length)
    })

    const fake: FakeGitHub = {
      layer,
      setPulls: value => Ref.set(pulls, value),
      setFailure: message => Ref.set(failure, Option.fromNullishOr(message)),
      calls: Ref.get(calls)
    }

    return fake
  })
