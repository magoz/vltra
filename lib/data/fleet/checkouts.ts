import type {
  FleetChildRow,
  FleetRow,
  LauncherList,
  LauncherWorktree
} from '@/lib/data/fleet/types'

// Which sessions belong to a checkout (a repository's primary or a worktree), for the launcher
// and the Projects page. Pure and free of Node APIs, so the browser uses it too.

/** `directory` is `place` or inside it. */
export const isWithin = (directory: string, place: string) =>
  directory === place || directory.startsWith(place.endsWith('/') ? place : `${place}/`)

/** The newest live root session in `directory` (or below it) whose folder still exists. */
export const latestSessionIn = (
  rows: ReadonlyArray<FleetRow>,
  directory: string
): string | undefined =>
  rows
    .filter(row => !row.gone && isWithin(row.directory, directory))
    .reduce<FleetRow | undefined>(
      (best, row) => (best === undefined || row.activeAt > best.activeAt ? row : best),
      undefined
    )?.id

/** The states that keep a checkout or project from being removed. */
export const busyStates: ReadonlyArray<FleetRow['state']> = ['working', 'blocked']

/** Root rows and subagents running in `directory` (or below it) that are working or blocked. */
export const busySessions = (
  rows: ReadonlyArray<FleetRow>,
  directory: string
): ReadonlyArray<FleetRow | FleetChildRow> =>
  rows
    .flatMap((row): ReadonlyArray<FleetRow | FleetChildRow> => [row, ...row.children])
    .filter(row => isWithin(row.directory, directory) && busyStates.includes(row.ownState))

/**
 * The launcher's linked worktree a session runs in (`directory` or below it; the deepest match),
 * for its branch and PR; none for a repository's primary checkout or before the list loads.
 */
export const worktreeAt = (
  list: LauncherList | undefined,
  directory: string
): LauncherWorktree | undefined =>
  (list?.entries ?? [])
    .flatMap(entry => entry.worktrees)
    .filter(worktree => isWithin(directory, worktree.directory))
    .reduce<LauncherWorktree | undefined>(
      (best, worktree) =>
        best === undefined || worktree.directory.length > best.directory.length ? worktree : best,
      undefined
    )
