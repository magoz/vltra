'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { FleetNav } from '@/app/fleet-context'
import {
  fleetHref,
  moveTo,
  projectParam,
  screenOf,
  sessionParam,
  viewParam
} from '@/app/fleet-href'
import type { FleetScreen } from '@/app/fleet-href'

/**
 * The dashboard's navigation from the URL: the tab, the filter and the open session, all in the
 * query of the one page (`fleet-href.ts`). Every move is a history write, which Next syncs into
 * `useSearchParams`, so nothing is fetched or remounted: switching tabs pushes an entry (Back
 * returns), the filter changes in place, and the launcher lands on Agents with the session open.
 */
export function useFleetNav(): FleetNav {
  const searchParams = useSearchParams()
  const screen = screenOf(searchParams.get(viewParam))
  const project = screen === 'projects' ? undefined : (searchParams.get(projectParam) ?? undefined)
  const session = searchParams.get(sessionParam) ?? undefined

  const href = useCallback(
    (target: FleetScreen, filter?: string) => {
      const to = moveTo({ screen, project }, target, filter)

      return fleetHref(to.screen, { project: to.project, session })
    },
    [screen, project, session]
  )

  const show = useCallback(
    (target: FleetScreen, filter?: string) => {
      const to = moveTo({ screen, project }, target, filter)

      if (to.screen === screen && to.project === project) return

      window.history.pushState(null, '', fleetHref(to.screen, { project: to.project, session }))
    },
    [screen, project, session]
  )

  const setProject = useCallback(
    (filter: string | undefined) =>
      window.history.replaceState(null, '', fleetHref(screen, { project: filter, session })),
    [screen, session]
  )

  const openSession = useCallback(
    (sessionID: string) =>
      window.history.pushState(null, '', fleetHref('focus', { session: sessionID })),
    []
  )

  return useMemo(
    () => ({ screen, project, href, show, setProject, openSession }),
    [screen, project, href, show, setProject, openSession]
  )
}
