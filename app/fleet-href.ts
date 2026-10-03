// The dashboard's URLs: two pages (`/` Agents, `/projects` Projects), the Agents page's mode
// (`?view=board`; focus is the default, so no param), the open session (`?session=<id>`) and the
// Agents page's project filter (`?project=<id>`). The mode and the session are kept across page
// switches, so the Agents tab returns to the mode it left. Pure, so links, keys and history writes
// agree.

export type FleetPage = 'agents' | 'projects'

/** The Agents page's modes: the needs-me list with the session inline, or the kanban board. */
export type AgentsView = 'focus' | 'board'

export const sessionParam = 'session'

export const projectParam = 'project'

export const viewParam = 'view'

const pagePaths: Readonly<Record<FleetPage, string>> = { agents: '/', projects: '/projects' }

/** The page a pathname shows; anything but `/projects` is the Agents page. */
export const pageOf = (pathname: string): FleetPage =>
  pathname === pagePaths.projects || pathname.startsWith(`${pagePaths.projects}/`)
    ? 'projects'
    : 'agents'

/** The Agents mode a `?view=` value names: `board`, else focus (the default). */
export const viewOf = (value: string | null | undefined): AgentsView =>
  value === 'board' ? 'board' : 'focus'

export type FleetLocation = {
  readonly project?: string | undefined
  readonly session?: string | undefined
  readonly view?: AgentsView | undefined
}

/** `page`'s URL with the given mode, filter (Agents only) and open session. */
export const fleetHref = (page: FleetPage, location: FleetLocation): string => {
  const params = new URLSearchParams()

  if (location.view === 'board') params.set(viewParam, 'board')

  if (page === 'agents' && location.project !== undefined) {
    params.set(projectParam, location.project)
  }

  if (location.session !== undefined) params.set(sessionParam, location.session)

  const query = params.toString()

  return query === '' ? pagePaths[page] : `${pagePaths[page]}?${query}`
}
