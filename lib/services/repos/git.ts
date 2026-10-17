import path from 'node:path'
import { Option, Schema } from 'effect'
import type { PullRequest, WorktreeOwner } from '@/lib/data/vltra/types'

// Pure readers for what git, gh and the dotfiles plugin write. Everything shaped by them stops
// here.

/** One record of `git worktree list --porcelain -z`. */
export type ListedWorktree = {
  readonly directory: string
  /** Short branch name; undefined when detached. */
  readonly branch: string | undefined
  readonly bare: boolean
  readonly prunable: boolean
}

const branchPrefix = 'refs/heads/'

/**
 * Parses `git worktree list --porcelain -z`: NUL-terminated attribute lines, records separated by
 * an empty line. The first record is the primary checkout.
 */
export const parseWorktreeList = (output: string): ReadonlyArray<ListedWorktree> =>
  output
    .split('\0\0')
    .map(record => record.split('\0').filter(line => line !== ''))
    .flatMap((lines): ReadonlyArray<ListedWorktree> => {
      const directory = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)

      if (directory === undefined || directory === '') return []

      const ref = lines.find(line => line.startsWith('branch '))?.slice('branch '.length)

      return [
        {
          directory,
          branch:
            ref === undefined
              ? undefined
              : ref.startsWith(branchPrefix)
                ? ref.slice(branchPrefix.length)
                : ref,
          bare: lines.includes('bare'),
          prunable: lines.some(line => line === 'prunable' || line.startsWith('prunable '))
        }
      ]
    })

/**
 * The private git dir named by a linked worktree's `.git` file (`gitdir: <path>`, relative to the
 * worktree when not absolute).
 */
export const gitDirOf = (worktree: string, dotGit: string): Option.Option<string> => {
  const line = dotGit
    .split('\n')
    .map(text => text.trim())
    .find(text => text.startsWith('gitdir:'))

  const target = line?.slice('gitdir:'.length).trim()

  if (target === undefined || target === '') return Option.none()

  return Option.some(path.resolve(worktree, target))
}

/** The dotfiles plugin's ownership marker file, in a worktree's private git dir. */
export const markerFile = 'dotfiles-worktree'

const Marker = Schema.fromJsonString(
  Schema.Struct({ strategy: Schema.Literal('dotfiles'), branch: Schema.String })
)

const decodeMarker = Schema.decodeUnknownOption(Marker)

/**
 * Who owns a linked worktree, from its marker's text (if any): `dotfiles` only when the marker is
 * the plugin's and names the worktree's current branch.
 */
export const markerOwner = (
  marker: Option.Option<string>,
  branch: string | undefined
): WorktreeOwner =>
  Option.match(Option.flatMap(marker, decodeMarker), {
    onNone: () => 'other',
    onSome: value => (branch !== undefined && value.branch === branch ? 'dotfiles' : 'other')
  })

const PullRequestList = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
      url: Schema.String,
      closingIssuesReferences: Schema.optional(
        Schema.Array(Schema.Struct({ number: Schema.Number, url: Schema.String }))
      )
    })
  )
)

const decodePullRequests = Schema.decodeUnknownOption(PullRequestList)

const prStates = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const

export const unknownPullRequest: PullRequest = { state: 'unknown' }

/**
 * `gh pr list --head <branch> --state all --json number,state,url,closingIssuesReferences --limit 1`:
 * the newest PR with the issues it closes, `none` for an empty list, `unknown` for anything
 * unreadable.
 */
export const parsePullRequests = (output: string): PullRequest =>
  Option.match(decodePullRequests(output), {
    onNone: () => unknownPullRequest,
    onSome: (list): PullRequest => {
      const latest = list[0]

      if (latest === undefined) return { state: 'none' }

      const pr: PullRequest = {
        state: prStates[latest.state],
        number: latest.number,
        url: latest.url
      }

      const issues = (latest.closingIssuesReferences ?? []).map(issue => ({
        number: issue.number,
        url: issue.url
      }))

      return issues.length === 0 ? pr : { ...pr, issues }
    }
  })

/**
 * The launcher roots: `VLTRA_LAUNCHER_ROOTS` (a `:`-separated path list, `~` for the home
 * directory), else `~/dev/repos` (whose children are the repositories), `~/.dotfiles`, `~/aha`,
 * `~/collie` and `~/subs`.
 */
export const launcherRoots = (configured: Option.Option<string>, home: string) =>
  Option.match(configured, {
    onNone: () => ['~/dev/repos', '~/.dotfiles', '~/aha', '~/collie', '~/subs'],
    onSome: list => list.split(path.delimiter)
  })
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .map(entry =>
      entry === '~' ? home : entry.startsWith('~/') ? path.join(home, entry.slice(2)) : entry
    )
    .filter(entry => path.isAbsolute(entry))
