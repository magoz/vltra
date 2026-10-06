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
import { fromParam, rangeParam, statsPeriodOf, toParam } from '@/lib/data/fleet/stats-period'
import type { StatsPeriod } from '@/lib/data/fleet/stats-period'

/**
 * The dashboard's navigation from the URL: the tab, the filter, Stats' range and the open session,
 * all in the query of the one page (`fleet-href.ts`). Every move is a history write, which Next
 * syncs into `useSearchParams`, so nothing is fetched or remounted: switching tabs pushes an entry
 * (Back returns), the filter and the range change in place, and the launcher lands on Agents with
 * the session open. Stats' range stays only while Stats shows.
 */
export function useFleetNav(): FleetNav {
  const searchParams = useSearchParams()
  const screen = screenOf(searchParams.get(viewParam))
  const project = screen === 'projects' ? undefined : (searchParams.get(projectParam) ?? undefined)
  const session = searchParams.get(sessionParam) ?? undefined
  const stats = screen === 'stats'
  const range = stats ? searchParams.get(rangeParam) : null
  const from = stats ? searchParams.get(fromParam) : null
  const to = stats ? searchParams.get(toParam) : null

  // Kept while the range's own params stay, so opening a session refetches nothing.
  const period = useMemo(
    () =>
      statsPeriodOf({
        get: name =>
          name === rangeParam ? range : name === fromParam ? from : name === toParam ? to : null
      }),
    [range, from, to]
  )

  const href = useCallback(
    (target: FleetScreen, filter?: string) => {
      const to = moveTo({ screen, project }, target, filter)

      return fleetHref(to.screen, { project: to.project, session, period })
    },
    [screen, project, session, period]
  )

  const show = useCallback(
    (target: FleetScreen, filter?: string) => {
      const to = moveTo({ screen, project }, target, filter)

      if (to.screen === screen && to.project === project) return

      window.history.pushState(
        null,
        '',
        fleetHref(to.screen, { project: to.project, session, period })
      )
    },
    [screen, project, session, period]
  )

  const setProject = useCallback(
    (filter: string | undefined) =>
      window.history.replaceState(
        null,
        '',
        fleetHref(screen, { project: filter, session, period })
      ),
    [screen, session, period]
  )

  const setPeriod = useCallback(
    (next: StatsPeriod) =>
      window.history.replaceState(null, '', fleetHref(screen, { project, session, period: next })),
    [screen, project, session]
  )

  const openSession = useCallback(
    (sessionID: string) =>
      window.history.pushState(null, '', fleetHref('focus', { session: sessionID })),
    []
  )

  return useMemo(
    () => ({ screen, project, period, href, show, setProject, setPeriod, openSession }),
    [screen, project, period, href, show, setProject, setPeriod, openSession]
  )
}
