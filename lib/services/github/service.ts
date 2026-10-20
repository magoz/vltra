import { Context, Schema } from 'effect'
import type { Effect } from 'effect'

/** One of the signed-in user's pull requests that was merged. */
export type MergedPull = {
  /** `owner/name`. */
  readonly repo: string
  readonly number: number
  /** Epoch milliseconds. */
  readonly createdAt: number
  readonly mergedAt: number
}

/** `[from, to)` in epoch ms. */
export type MergeWindow = { readonly from: number; readonly to: number }

/** `gh` is missing, signed out, or GitHub answered something Vltra cannot read. */
export class GitHubUnavailableError extends Schema.TaggedError<GitHubUnavailableError>()(
  'GitHubUnavailableError',
  { message: Schema.String }
) {}

export type GitHubOperations = {
  /** The user's pull requests merged in the window, whoever merged them, in any repository. */
  readonly merged: (
    window: MergeWindow
  ) => Effect.Effect<ReadonlyArray<MergedPull>, GitHubUnavailableError>
  /** How many of them, without reading them (one call). */
  readonly mergedCount: (window: MergeWindow) => Effect.Effect<number, GitHubUnavailableError>
}

/** GitHub, through the host's `gh` and its signed-in user (`gh api graphql`). Read-only. */
export class GitHub extends Context.Service<GitHub, GitHubOperations>()('@vltra/GitHub') {}
