// The dashboard is one page, `/`: the tab in `?view=` (Focus, the default, so no param; `agents`;
// `projects`), the open session (`?session=<id>`, kept across tabs) and Focus' and Agents' project
// filter (`?project=<id>`). One route on purpose: Cache Components keeps up to three visited
// routes mounted in hidden `<Activity>` boundaries, so a second route kept a hidden copy of the
// other page (with its own OpenCode chat) alive and restored its stale state on return.
// Pure, so links, keys and history writes agree.

/** The tabs: Focus (the needs-me list, the session inline), Agents (the kanban) and Projects. */
export type FleetScreen = 'focus' | 'agents' | 'projects'

export const sessionParam = 'session'

export const projectParam = 'project'

export const viewParam = 'view'

/**
 * The tab a `?view=` value names: `agents`, `projects`, else Focus (the default). `board`, the
 * Agents tab's old name, still opens it, so old links keep working.
 */
export const screenOf = (value: string | null | undefined): FleetScreen => {
  if (value === 'board') return 'agents'

  return value === 'agents' || value === 'projects' ? value : 'focus'
}

/** A tab and its filter (Focus and Agents only). */
export type FleetPlace = { readonly screen: FleetScreen; readonly project: string | undefined }

/**
 * Where moving to `screen` lands: filtered to `project` when given, else Focus and Agents keep the
 * filter between themselves; Projects has none, so from it they start unfiltered.
 */
export const moveTo = (from: FleetPlace, screen: FleetScreen, project?: string): FleetPlace => ({
  screen,
  project: screen === 'projects' ? undefined : (project ?? from.project)
})

export type FleetLocation = {
  readonly project?: string | undefined
  readonly session?: string | undefined
}

/** `screen`'s URL with its filter (Focus and Agents only) and the open session. */
export const fleetHref = (screen: FleetScreen, location: FleetLocation): string => {
  const params = new URLSearchParams()

  if (screen !== 'focus') params.set(viewParam, screen)

  if (screen !== 'projects' && location.project !== undefined) {
    params.set(projectParam, location.project)
  }

  if (location.session !== undefined) params.set(sessionParam, location.session)

  const query = params.toString()

  return query === '' ? '/' : `/?${query}`
}
