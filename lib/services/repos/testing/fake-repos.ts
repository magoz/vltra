import { Effect, Layer, Option, Ref } from 'effect'
import type { PullRequest, RepoCheckout } from '@/lib/data/fleet/types'
import { Repos } from '@/lib/services/repos/service'
import type { CheckoutInfo } from '@/lib/services/repos/service'

export type FakeRepos = {
  readonly layer: Layer.Layer<Repos>
  readonly setRepos: (repos: ReadonlyArray<RepoCheckout>) => Effect.Effect<void>
  readonly setPullRequest: (repo: string, branch: string, pr: PullRequest) => Effect.Effect<void>
  /** The `extra` directories of every `list` call. */
  readonly listed: Effect.Effect<ReadonlyArray<ReadonlyArray<string>>>
}

const prKey = (repo: string, branch: string) => `${repo}\0${branch}`

/** What `inspect` says about a directory of `repos`: a primary on `main`, or a worktree. */
const inspectIn = (repos: ReadonlyArray<RepoCheckout>, directory: string) => {
  for (const repo of repos) {
    if (repo.directory === directory) {
      const info: CheckoutInfo = {
        directory,
        primary: directory,
        linked: false,
        branch: 'main',
        owner: 'other'
      }

      return Option.some(info)
    }

    const worktree = repo.worktrees.find(item => item.directory === directory)

    if (worktree !== undefined) {
      const info: CheckoutInfo = {
        directory,
        primary: repo.directory,
        linked: true,
        branch: worktree.branch,
        owner: worktree.owner
      }

      return Option.some(info)
    }
  }

  return Option.none<CheckoutInfo>()
}

/**
 * In-memory repositories: `list` returns them (ignoring roots and extras, which it records),
 * `inspect` knows their checkouts, `pullRequest` answers what was set (else `none`).
 */
export const makeFakeRepos = (initial: ReadonlyArray<RepoCheckout> = []) =>
  Effect.gen(function* () {
    const repos = yield* Ref.make(initial)
    const prs = yield* Ref.make<ReadonlyMap<string, PullRequest>>(new Map())
    const listed = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([])

    const layer = Layer.succeed(Repos, {
      list: extra =>
        Effect.andThen(
          Ref.update(listed, calls => [...calls, Array.from(extra)]),
          Ref.get(repos)
        ),
      inspect: directory => Effect.map(Ref.get(repos), list => inspectIn(list, directory)),
      pullRequest: ({ repo, branch }) =>
        Effect.map(Ref.get(prs), map => map.get(prKey(repo, branch)) ?? { state: 'none' })
    })

    const fake: FakeRepos = {
      layer,
      setRepos: value => Ref.set(repos, value),
      setPullRequest: (repo, branch, pr) =>
        Ref.update(prs, map => new Map(map).set(prKey(repo, branch), pr)),
      listed: Ref.get(listed)
    }

    return fake
  })
