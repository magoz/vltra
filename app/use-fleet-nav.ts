'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { FleetNav } from '@/app/fleet-context'
import { fleetHref, pageOf, projectParam, sessionParam, viewOf, viewParam } from '@/app/fleet-href'
import type { AgentsView, FleetPage } from '@/app/fleet-href'

/**
 * The dashboard's navigation from the URL: the page from the path; the Agents mode, the project
 * filter and the open session from the query. Page switches are router navigations (both pages
 * share the layout that holds the live fleet, so nothing reloads); the filter changes in place;
 * a mode switch pushes a history entry, so Back returns to the other mode. The launcher lands in
 * focus mode with the session open.
 */
export function useFleetNav(): FleetNav {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = pageOf(pathname)
  const view = viewOf(searchParams.get(viewParam))
  const project = searchParams.get(projectParam) ?? undefined
  const session = searchParams.get(sessionParam) ?? undefined

  const href = useCallback(
    (target: FleetPage, filter?: string, mode?: AgentsView) =>
      fleetHref(target, { project: filter, session, view: mode ?? view }),
    [session, view]
  )

  const go = useCallback(
    (target: FleetPage, filter?: string, mode?: AgentsView) =>
      router.push(href(target, filter, mode)),
    [router, href]
  )

  const setProject = useCallback(
    (filter: string | undefined) =>
      window.history.replaceState(
        null,
        '',
        fleetHref('agents', { project: filter, session, view })
      ),
    [session, view]
  )

  const setView = useCallback(
    (mode: AgentsView) => {
      if (mode === view) return

      window.history.pushState(null, '', fleetHref('agents', { project, session, view: mode }))
    },
    [project, session, view]
  )

  const openSession = useCallback(
    (sessionID: string) => router.push(fleetHref('agents', { session: sessionID, view: 'focus' })),
    [router]
  )

  return useMemo(
    () => ({ page, view, project, href, go, setProject, setView, openSession }),
    [page, view, project, href, go, setProject, setView, openSession]
  )
}
