'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { fleetHref } from '@/app/fleet-href'
import type { AgentsView, FleetPage } from '@/app/fleet-href'
import type { LiveFleet } from '@/lib/data/fleet/board'

/** The open session (`?session=`, see `use-selected-session.ts`). */
export type SessionSelection = {
  readonly selected: string | undefined
  readonly select: (sessionID: string) => void
  readonly close: () => void
}

/** Where the dashboard is (page, mode, project filter) and how to move (`use-fleet-nav.ts`). */
export type FleetNav = {
  readonly page: FleetPage
  /** The Agents page's mode (`?view=board`, else focus); kept across page switches. */
  readonly view: AgentsView
  /** The Agents page's filter (`?project=`, a `projectKey`). */
  readonly project: string | undefined
  /** A page's URL, keeping the open session and (unless given) the current mode. */
  readonly href: (page: FleetPage, project?: string, view?: AgentsView) => string
  /** Navigates to a page (pushes a history entry), keeping the open session and the mode. */
  readonly go: (page: FleetPage, project?: string, view?: AgentsView) => void
  /** Changes the Agents page's filter in place (replaces the history entry). */
  readonly setProject: (project: string | undefined) => void
  /** Switches the Agents mode (pushes a history entry), keeping the filter and the session. */
  readonly setView: (view: AgentsView) => void
}

/** What both pages read: the live fleet (optimistic overrides applied), the clock, the URL. */
export type Fleet = {
  readonly view: LiveFleet
  readonly now: number
  readonly selection: SessionSelection
  readonly nav: FleetNav
}

const FleetContext = createContext<Fleet | undefined>(undefined)

export function FleetProvider({
  fleet,
  children
}: {
  readonly fleet: Fleet
  readonly children: ReactNode
}) {
  return <FleetContext value={fleet}>{children}</FleetContext>
}

export function useFleet(): Fleet {
  const fleet = useContext(FleetContext)

  if (fleet === undefined) throw new Error('useFleet needs a FleetProvider')

  return fleet
}

/** A session's URL on the current page (inline in focus mode, else the drawer over the page). */
export const sessionHref = (nav: FleetNav, sessionID: string) =>
  fleetHref(nav.page, { project: nav.project, session: sessionID, view: nav.view })
