import { Context } from 'effect'
import type { Effect, Option } from 'effect'
import type { PullRequest, RepoCheckout, WorktreeOwner } from '@/lib/data/vltra/types'

/** One checkout as git sees it (`Repos.inspect`). Paths are canonical (real). */
export type CheckoutInfo = {
  /** The checkout's top level. */
  readonly directory: string
  /** Its repository's primary checkout (itself when it is the primary). */
  readonly primary: string
  /** A linked worktree (`.git` is a file), not the primary checkout. */
  readonly linked: boolean
  /** Checked-out branch; undefined when detached. */
  readonly branch: string | undefined
  /** `dotfiles` only for a linked worktree with the plugin's marker for its current branch. */
  readonly owner: WorktreeOwner
}

export type ReposOperations = {
  /**
   * The git repositories under the launcher roots (each root is a repository, or a folder whose
   * child repositories count), plus `extra` repository directories (OpenCode's projects), each
   * with its linked worktrees and their owners. Linked worktrees are never listed on their own;
   * they belong to their primary. Missing roots and broken repositories are skipped.
   */
  readonly list: (extra: Iterable<string>) => Effect.Effect<ReadonlyArray<RepoCheckout>>
  /**
   * The launcher roots that are plain folders: a directory that is not a repository and has no
   * repository (or linked worktree) among its children, so `list` finds nothing in it. Canonical
   * paths; missing roots are skipped.
   */
  readonly folders: Effect.Effect<ReadonlyArray<string>>
  /** The checkout whose top level is `directory`; none when it is not one (or is gone). */
  readonly inspect: (directory: string) => Effect.Effect<Option.Option<CheckoutInfo>>
  /**
   * The branch's pull request (`gh pr list --head <branch>` in the repository), cached for a few
   * minutes. Waits briefly for a lookup that is not cached yet and answers `unknown` meanwhile (it
   * keeps running and lands in the cache); failures are `unknown`, no PR is `none`.
   */
  readonly pullRequest: (input: {
    readonly repo: string
    readonly branch: string
  }) => Effect.Effect<PullRequest>
}

/** Git repositories and worktrees on Box, for the launcher. Vltra runs next to them. */
export class Repos extends Context.Service<Repos, ReposOperations>()('@vltra/Repos') {}
