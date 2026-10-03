'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useFleet } from '@/app/fleet-context'
import type { AgentsView, FleetPage } from '@/app/fleet-href'
import { isPlainClick } from '@/app/session-row'

/**
 * A link to one of the two pages (optionally Agents filtered to `project`, in `view` or else the
 * current mode), keeping the open session. Prefetched like any `Link`; a plain click navigates
 * through `nav.go`.
 */
export function NavLink({
  page,
  project,
  view,
  current,
  className,
  children
}: {
  readonly page: FleetPage
  readonly project?: string
  /** The Agents mode to open; the current one when left out. */
  readonly view?: AgentsView
  /** Marks the link as the current page (the tabs). */
  readonly current?: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  const { nav } = useFleet()

  return (
    <Link
      href={nav.href(page, project, view)}
      aria-current={current === true ? 'page' : undefined}
      onClick={event => {
        if (!isPlainClick(event)) return

        event.preventDefault()
        nav.go(page, project, view)
      }}
      className={className}
    >
      {children}
    </Link>
  )
}
