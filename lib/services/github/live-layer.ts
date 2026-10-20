import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { Duration, Effect, Layer, Option, Semaphore, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import {
  failureMessage,
  mergedQuery,
  pageSize,
  parseSearchPage,
  searchCap,
  searchDocument
} from '@/lib/services/github/search'
import type { SearchPage } from '@/lib/services/github/search'
import { GitHub, GitHubUnavailableError } from '@/lib/services/github/service'
import type { GitHubOperations, MergedPull, MergeWindow } from '@/lib/services/github/service'

export type GitHubOptions = {
  /** Extra environment for `gh` (tests put a fake one first on `PATH`). */
  readonly env?: Readonly<Record<string, string>>
}

const ghTimeout = Duration.seconds(20)

/** `gh` processes at once (each is a GitHub API call). */
const ghConcurrency = 2

const quietEnv = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }

const unavailable = (message: string) => new GitHubUnavailableError({ message })

export const makeGitHub = (options: GitHubOptions = {}) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const permits = yield* Semaphore.make(ghConcurrency)
    const env = { ...quietEnv, ...options.env }

    /** `gh api graphql` (argv, no shell): its stdout, or why it failed. */
    const graphql = (variables: ReadonlyArray<string>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make(
            'gh',
            ['api', 'graphql', '-f', `query=${searchDocument}`, ...variables],
            { env, extendEnv: true, stdin: 'ignore', stderr: 'ignore' }
          )

          return yield* Effect.all(
            [handle.stdout.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
            { concurrency: 2 }
          )
        })
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError(error => unavailable(`gh could not run: ${error.message}`)),
        Effect.timeoutOrElse({
          duration: ghTimeout,
          orElse: () => Effect.fail(unavailable('gh timed out'))
        }),
        Effect.flatMap(([stdout, exitCode]) =>
          exitCode === 0
            ? Effect.succeed(stdout)
            : Effect.fail(unavailable(failureMessage(exitCode, stdout)))
        ),
        permits.withPermits(1)
      )

    const page = (window: MergeWindow, first: number, cursor: string | undefined) =>
      Effect.flatMap(
        graphql([
          '-f',
          `q=${mergedQuery(window)}`,
          '-F',
          `first=${first}`,
          ...(cursor === undefined ? [] : ['-f', `cursor=${cursor}`])
        ]),
        stdout =>
          Option.match(parseSearchPage(stdout, window), {
            onNone: () => Effect.fail(unavailable('GitHub answer unreadable')),
            onSome: value => Effect.succeed(value)
          })
      )

    /** Every page after `first`. */
    const rest = (window: MergeWindow, first: SearchPage) =>
      Effect.gen(function* () {
        const pulls: Array<MergedPull> = [...first.pulls]
        let next = first.next

        while (next !== undefined) {
          const following = yield* page(window, pageSize, next)

          pulls.push(...following.pulls)
          next = following.next
        }

        return pulls
      })

    // Past the search's cap, the halves are read on their own (GitHub returns only the first
    // thousand of a query, however many it counts).
    const merged = (
      window: MergeWindow
    ): Effect.Effect<ReadonlyArray<MergedPull>, GitHubUnavailableError> =>
      Effect.gen(function* () {
        if (window.from >= window.to) return []

        const first = yield* page(window, pageSize, undefined)

        if (first.count <= searchCap || window.to - window.from <= 2000) {
          return yield* rest(window, first)
        }

        const middle = window.from + Math.floor((window.to - window.from) / 2)
        const left = yield* merged({ from: window.from, to: middle })
        const right = yield* merged({ from: middle, to: window.to })

        return [...left, ...right]
      })

    const mergedCount = (window: MergeWindow) =>
      window.from >= window.to
        ? Effect.succeed(0)
        : Effect.map(page(window, 1, undefined), first => first.count)

    const operations: GitHubOperations = {
      merged: window => merged(window).pipe(Effect.withSpan('github.merged')),
      mergedCount: window => mergedCount(window).pipe(Effect.withSpan('github.mergedCount'))
    }

    return operations
  })

export const GitHubLive = Layer.effect(GitHub, makeGitHub()).pipe(
  Layer.provide(NodeChildProcessSpawner.layer),
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
)
