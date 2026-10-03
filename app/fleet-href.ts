// The dashboard's URLs: two pages (`/` Agents, `/projects` Projects), the open session
// (`?session=<id>`, a drawer over either page) and the Agents board's project filter
// (`?project=<id>`). Pure, so links, keys and history writes agree.

export type FleetPage = 'agents' | 'projects'

export const sessionParam = 'session'

export const projectParam = 'project'

const pagePaths: Readonly<Record<FleetPage, string>> = { agents: '/', projects: '/projects' }

/** The page a pathname shows; anything but `/projects` is the Agents board. */
export const pageOf = (pathname: string): FleetPage =>
  pathname === pagePaths.projects || pathname.startsWith(`${pagePaths.projects}/`)
    ? 'projects'
    : 'agents'

export type FleetLocation = {
  readonly project?: string | undefined
  readonly session?: string | undefined
}

/** `page`'s URL with the given filter (Agents only) and open session. */
export const fleetHref = (page: FleetPage, location: FleetLocation): string => {
  const params = new URLSearchParams()

  if (page === 'agents' && location.project !== undefined) {
    params.set(projectParam, location.project)
  }

  if (location.session !== undefined) params.set(sessionParam, location.session)

  const query = params.toString()

  return query === '' ? pagePaths[page] : `${pagePaths[page]}?${query}`
}
