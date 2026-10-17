'use client'

import type { ReactNode } from 'react'
import { useVltra } from '@/app/vltra-context'
import type { VltraScreen } from '@/app/vltra-href'
import { isPlainClick } from '@/app/session-row'

/**
 * A link to a tab (Focus or Agents optionally filtered to `project`), keeping the open session: a
 * real link (new tab, copy) whose plain click switches in place through `nav.show`. The
 * dashboard is one page, so there is nothing to prefetch or navigate.
 */
export function NavLink({
  screen,
  project,
  current,
  className,
  children
}: {
  readonly screen: VltraScreen
  readonly project?: string
  /** Marks the link as the tab showing (the header's and the phone's tabs). */
  readonly current?: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  const { nav } = useVltra()

  return (
    <a
      href={nav.href(screen, project)}
      aria-current={current === true ? 'page' : undefined}
      onClick={event => {
        if (!isPlainClick(event)) return

        event.preventDefault()
        nav.show(screen, project)
      }}
      className={className}
    >
      {children}
    </a>
  )
}
