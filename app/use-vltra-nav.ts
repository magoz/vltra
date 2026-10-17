'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { VltraNav } from '@/app/vltra-context'
import {
  vltraHref,
  hasFilter,
  moveTo,
  projectParam,
  screenOf,
  sessionParam,
  viewParam
} from '@/app/vltra-href'
import type { VltraScreen } from '@/app/vltra-href'
import { fromParam, rangeParam, statsPeriodOf, toParam } from '@/lib/data/vltra/stats-period'
import type { StatsPeriod } from '@/lib/data/vltra/stats-period'

/**
 * The dashboard's navigation from the URL: the tab, the filter, Stats' range and the open session,
 * all in the query of the one page (`vltra-href.ts`). Every move is a history write, which Next
 * syncs into `useSearchParams`, so nothing is fetched or remounted: switching tabs pushes an entry
 * (Back returns), the filter and the range change in place, and the launcher lands on Agents with
 * the session open. Stats' range stays only while Stats shows.
 */
export function useVltraNav(): VltraNav {
  const searchParams = useSearchParams()
  const screen = screenOf(searchParams.get(viewParam))
  const project = hasFilter(screen) ? (searchParams.get(projectParam) ?? undefined) : undefined
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
    (target: VltraScreen, filter?: string) => {
      const to = moveTo({ screen, project }, target, filter)

      return vltraHref(to.screen, { project: to.project, session, period })
    },
    [screen, project, session, period]
  )

  const show = useCallback(
    (target: VltraScreen, filter?: string) => {
      const to = moveTo({ screen, project }, target, filter)

      if (to.screen === screen && to.project === project) return

      window.history.pushState(
        null,
        '',
        vltraHref(to.screen, { project: to.project, session, period })
      )
    },
    [screen, project, session, period]
  )

  const setProject = useCallback(
    (filter: string | undefined) =>
      window.history.replaceState(
        null,
        '',
        vltraHref(screen, { project: filter, session, period })
      ),
    [screen, session, period]
  )

  const setPeriod = useCallback(
    (next: StatsPeriod) =>
      window.history.replaceState(null, '', vltraHref(screen, { project, session, period: next })),
    [screen, project, session]
  )

  const openSession = useCallback(
    (sessionID: string) =>
      window.history.pushState(null, '', vltraHref('focus', { session: sessionID })),
    []
  )

  return useMemo(
    () => ({ screen, project, period, href, show, setProject, setPeriod, openSession }),
    [screen, project, period, href, show, setProject, setPeriod, openSession]
  )
}
