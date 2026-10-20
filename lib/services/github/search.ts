import { Option, Schema } from 'effect'
import type { MergedPull, MergeWindow } from '@/lib/services/github/service'

// Pure readers and writers for GitHub's GraphQL search, as `gh api graphql` sends and prints it.
// Everything shaped by GitHub stops here.

/** Results GitHub's search returns at most for one query, however many it counts. */
export const searchCap = 1000

/** Results per page (GitHub's most). */
export const pageSize = 100

/** The search: every node a pull request, so the fragment always matches. */
export const searchDocument = `query($q: String!, $first: Int!, $cursor: String) {
  search(query: $q, type: ISSUE, first: $first, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number createdAt mergedAt repository { nameWithOwner } } }
  }
}`

/** `2026-10-20T12:00:00Z`: GitHub's qualifiers take whole seconds. */
const isoSeconds = (millis: number) => new Date(millis).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * The user's merged pull requests in `[from, to)`: `merged:` includes both ends, to the second, so
 * it ends a second before `to` (`toPulls` drops anything outside the window anyway).
 */
export const mergedQuery = ({ from, to }: MergeWindow) =>
  `is:pr author:@me is:merged merged:${isoSeconds(from)}..${isoSeconds(Math.max(from, to - 1000))}`

const SearchResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({
      issueCount: Schema.Number,
      pageInfo: Schema.Struct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.NullOr(Schema.String)
      }),
      nodes: Schema.Array(
        Schema.Struct({
          number: Schema.Number,
          createdAt: Schema.String,
          mergedAt: Schema.NullOr(Schema.String),
          repository: Schema.Struct({ nameWithOwner: Schema.String })
        })
      )
    })
  })
})

export type SearchPage = {
  readonly count: number
  /** The next page's cursor; none on the last page. */
  readonly next: string | undefined
  readonly pulls: ReadonlyArray<MergedPull>
}

const decodeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(SearchResponse))

const time = (value: string | null) => {
  const millis = value === null ? Number.NaN : Date.parse(value)

  return Number.isFinite(millis) ? Option.some(millis) : Option.none()
}

/** One page of `searchDocument`'s answer, its pulls inside `window`; none when unreadable. */
export const parseSearchPage = (output: string, window: MergeWindow): Option.Option<SearchPage> =>
  Option.map(decodeResponse(output), ({ data: { search } }) => ({
    count: search.issueCount,
    next: search.pageInfo.hasNextPage ? (search.pageInfo.endCursor ?? undefined) : undefined,
    pulls: search.nodes.flatMap(node =>
      Option.match(Option.all([time(node.createdAt), time(node.mergedAt)]), {
        onNone: () => [],
        onSome: ([createdAt, mergedAt]) =>
          mergedAt >= window.from && mergedAt < window.to
            ? [{ repo: node.repository.nameWithOwner, number: node.number, createdAt, mergedAt }]
            : []
      })
    )
  }))

const GhFailure = Schema.fromJsonString(Schema.Struct({ message: Schema.String }))

const decodeFailure = Schema.decodeUnknownOption(GhFailure)

/** `gh`'s exit code when it has no signed-in user. */
const ghSignedOut = 4

/** Why a `gh api` call failed, from its exit code and the error body it prints. */
export const failureMessage = (exitCode: number, stdout: string) =>
  exitCode === ghSignedOut
    ? 'gh is not signed in'
    : Option.match(decodeFailure(stdout), {
        onNone: () => `gh api failed (exit ${exitCode})`,
        onSome: body => `GitHub: ${body.message}`
      })
