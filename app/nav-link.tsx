'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useFleet } from '@/app/fleet-context'
import type { FleetPage } from '@/app/fleet-href'
import { isPlainClick } from '@/app/session-row'

/**
 * A link to one of the two pages (optionally the board filtered to `project`), keeping the open
 * session. Prefetched like any `Link`; a plain click navigates through `nav.go`.
 */
export function NavLink({
  page,
  project,
  current,
  className,
  children
}: {
  readonly page: FleetPage
  readonly project?: string
  /** Marks the link as the current page (the tabs). */
  readonly current?: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  const { nav } = useFleet()

  return (
    <Link
      href={nav.href(page, project)}
      aria-current={current === true ? 'page' : undefined}
      onClick={event => {
        if (!isPlainClick(event)) return

        event.preventDefault()
        nav.go(page, project)
      }}
      className={className}
    >
      {children}
    </Link>
  )
}
