'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { FleetNav } from '@/app/fleet-context'
import { fleetHref, pageOf, projectParam, sessionParam } from '@/app/fleet-href'
import type { FleetPage } from '@/app/fleet-href'

/**
 * The dashboard's navigation from the URL: the page from the path, the project filter and the
 * open session from the query. Page switches are router navigations (both pages share the layout
 * that holds the live fleet, so nothing reloads); the filter changes in place.
 */
export function useFleetNav(): FleetNav {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = pageOf(pathname)
  const project = searchParams.get(projectParam) ?? undefined
  const session = searchParams.get(sessionParam) ?? undefined

  const href = useCallback(
    (target: FleetPage, filter?: string) => fleetHref(target, { project: filter, session }),
    [session]
  )

  const go = useCallback(
    (target: FleetPage, filter?: string) => router.push(href(target, filter)),
    [router, href]
  )

  const setProject = useCallback(
    (filter: string | undefined) =>
      window.history.replaceState(null, '', fleetHref('agents', { project: filter, session })),
    [session]
  )

  return useMemo(
    () => ({ page, project, href, go, setProject }),
    [page, project, href, go, setProject]
  )
}
