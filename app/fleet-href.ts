import { statsPeriodParams } from '@/lib/data/fleet/stats-period'
import type { StatsPeriod } from '@/lib/data/fleet/stats-period'

// The dashboard is one page, `/`: the tab in `?view=` (Focus, the default, so no param; `agents`;
// `projects`; `stats`; `settings`), the open session (`?session=<id>`, kept across tabs), the project filter
// of Agents and Stats (`?project=<id>`, kept while Focus shows, which ignores it) and Stats' range
// (`?range=` or `?from=&to=`, `stats-period.ts`; Stats only). One route on purpose: Cache
// Components keeps up to three visited routes mounted in hidden `<Activity>` boundaries, so a
// second route kept a hidden copy of the other page (with its own OpenCode chat) alive and
// restored its stale state on return.
// Pure, so links, keys and history writes agree.

/**
 * The tabs: Focus (the needs-me list, the session inline), Agents (the kanban), Projects, Stats
 * (charts of OpenCode's activity) and Settings (notifications).
 */
export type FleetScreen = 'focus' | 'agents' | 'projects' | 'stats' | 'settings'

export const sessionParam = 'session'

export const projectParam = 'project'

export const viewParam = 'view'

/**
 * The tab a `?view=` value names: `agents`, `projects`, `stats`, `settings`, else Focus (the
 * default). `board`, the Agents tab's old name, still opens it, so old links keep working.
 */
export const screenOf = (value: string | null | undefined): FleetScreen => {
  if (value === 'board') return 'agents'

  return value === 'agents' || value === 'projects' || value === 'stats' || value === 'settings'
    ? value
    : 'focus'
}

/** Projects and Settings have no project filter. */
export const hasFilter = (screen: FleetScreen): boolean =>
  screen !== 'projects' && screen !== 'settings'

/** A tab and Agents' filter (kept on Focus, which ignores it). */
export type FleetPlace = { readonly screen: FleetScreen; readonly project: string | undefined }

/**
 * Where moving to `screen` lands: filtered to `project` when given, else Focus, Agents and Stats
 * keep the filter between themselves; Projects and Settings have none, so from them they start
 * unfiltered.
 */
export const moveTo = (from: FleetPlace, screen: FleetScreen, project?: string): FleetPlace => ({
  screen,
  project: hasFilter(screen) ? (project ?? from.project) : undefined
})

export type FleetLocation = {
  readonly project?: string | undefined
  readonly session?: string | undefined
  /** Stats' range; left out on the other tabs and when it is the default. */
  readonly period?: StatsPeriod | undefined
}

/** `screen`'s URL with its filter (`hasFilter`), Stats' range and the open session. */
export const fleetHref = (screen: FleetScreen, location: FleetLocation): string => {
  const params = new URLSearchParams()

  if (screen !== 'focus') params.set(viewParam, screen)

  if (hasFilter(screen) && location.project !== undefined) {
    params.set(projectParam, location.project)
  }

  if (screen === 'stats' && location.period !== undefined) {
    for (const [name, value] of statsPeriodParams(location.period)) params.set(name, value)
  }

  if (location.session !== undefined) params.set(sessionParam, location.session)

  const query = params.toString()

  return query === '' ? '/' : `/?${query}`
}
