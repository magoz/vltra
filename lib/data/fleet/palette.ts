import type { LauncherEntry, LauncherWorktree } from '@/lib/data/fleet/types'

// The launcher palette's rows: repositories and their worktrees, fuzzy-filtered by what was typed.
// Pure.

const isBoundary = (character: string | undefined) =>
  character === undefined || /[\s/._-]/.test(character)

/**
 * How well `query` matches `text` as a case-insensitive subsequence; undefined when it does not.
 * Consecutive characters and word starts score higher, so `fl` ranks `fleet` above `afloat`.
 */
export const fuzzyScore = (query: string, text: string): number | undefined => {
  const needle = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const haystack = text.toLowerCase()

  if (needle === '') return 0

  let score = 0
  let from = 0
  let previous = -2

  for (const character of needle) {
    if (character === ' ') continue

    const index = haystack.indexOf(character, from)

    if (index < 0) return undefined

    score += 1

    if (index === previous + 1) score += 3

    if (isBoundary(haystack[index - 1])) score += 2

    previous = index
    from = index + 1
  }

  // Among equal matches, the shorter text is the closer one.
  return score - haystack.length / 100
}

export type PaletteItem =
  | { readonly kind: 'repo'; readonly key: string; readonly entry: LauncherEntry }
  | {
      readonly kind: 'worktree'
      readonly key: string
      readonly entry: LauncherEntry
      readonly worktree: LauncherWorktree
    }

const lastSegment = (directory: string) =>
  directory.split('/').findLast(segment => segment !== '') ?? directory

/** A worktree's name in the palette: its branch, else its folder (detached). */
export const worktreeName = (worktree: Pick<LauncherWorktree, 'branch' | 'directory'>) =>
  worktree.branch ?? lastSegment(worktree.directory)

const itemText = (item: PaletteItem) =>
  item.kind === 'repo'
    ? item.entry.name
    : `${item.entry.name} ${worktreeName(item.worktree)} ${lastSegment(item.worktree.directory)}`

/**
 * The palette's rows for `query`: every repository followed by its worktrees, in the launcher's
 * order (most recent agent activity first); with a query, only the matches, best first (ties keep
 * that order).
 */
export const paletteItems = (
  entries: ReadonlyArray<LauncherEntry>,
  query: string
): ReadonlyArray<PaletteItem> => {
  const items = entries.flatMap((entry): ReadonlyArray<PaletteItem> => [
    { kind: 'repo', key: entry.directory, entry },
    ...entry.worktrees.map((worktree): PaletteItem => ({
      kind: 'worktree',
      key: worktree.directory,
      entry,
      worktree
    }))
  ])

  if (query.trim() === '') return items

  return items
    .flatMap((item, index) => {
      const score = fuzzyScore(query, itemText(item))

      return score === undefined ? [] : [{ item, index, score }]
    })
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map(match => match.item)
}
