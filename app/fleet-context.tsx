'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { fleetHref } from '@/app/fleet-href'
import type { FleetScreen } from '@/app/fleet-href'
import type { LiveFleet } from '@/lib/data/fleet/board'

/** The open session (`?session=`, see `use-selected-session.ts`). */
export type SessionSelection = {
  readonly selected: string | undefined
  readonly select: (sessionID: string) => void
  readonly close: () => void
}

/** Where the dashboard is (tab, project filter) and how to move (`use-fleet-nav.ts`). */
export type FleetNav = {
  /** The tab (`?view=`). */
  readonly screen: FleetScreen
  /** Focus' and Agents' filter (`?project=`, a `projectKey`); never set on Projects. */
  readonly project: string | undefined
  /** `screen`'s URL (`moveTo` for the filter), keeping the open session. */
  readonly href: (screen: FleetScreen, project?: string) => string
  /** Shows `href`'s URL in place, pushing a history entry (nothing when already there). */
  readonly show: (screen: FleetScreen, project?: string) => void
  /** Changes the filter in place (replaces the history entry). */
  readonly setProject: (project: string | undefined) => void
  /** Opens a session on the Focus tab, unfiltered (the launcher's landing): pushes an entry. */
  readonly openSession: (sessionID: string) => void
}

/** What every tab reads: the live fleet (optimistic overrides applied), the clock, the URL. */
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

/** A session's URL on the current tab (its chat opens beside the tab). */
export const sessionHref = (nav: FleetNav, sessionID: string) =>
  fleetHref(nav.screen, { project: nav.project, session: sessionID })
