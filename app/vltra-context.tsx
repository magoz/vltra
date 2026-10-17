'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { vltraHref } from '@/app/vltra-href'
import type { VltraScreen } from '@/app/vltra-href'
import type { LiveVltra } from '@/lib/data/vltra/board'
import type { StatsPeriod } from '@/lib/data/vltra/stats-period'

/** The open session (`?session=`, see `use-selected-session.ts`). */
export type SessionSelection = {
  readonly selected: string | undefined
  readonly select: (sessionID: string) => void
  readonly close: () => void
}

/** Where the dashboard is (tab, project filter) and how to move (`use-vltra-nav.ts`). */
export type VltraNav = {
  /** The tab (`?view=`). */
  readonly screen: VltraScreen
  /** The filter of Focus, Agents and Stats (`?project=`, a `projectKey`); never set on Projects. */
  readonly project: string | undefined
  /** Stats' range (`?range=` / `?from=&to=`); the default on the other tabs. */
  readonly period: StatsPeriod
  /** `screen`'s URL (`moveTo` for the filter), keeping the open session. */
  readonly href: (screen: VltraScreen, project?: string) => string
  /** Shows `href`'s URL in place, pushing a history entry (nothing when already there). */
  readonly show: (screen: VltraScreen, project?: string) => void
  /** Changes the filter in place (replaces the history entry). */
  readonly setProject: (project: string | undefined) => void
  /** Changes Stats' range in place (replaces the history entry). */
  readonly setPeriod: (period: StatsPeriod) => void
  /** Opens a session on the Focus tab, unfiltered (the launcher's landing): pushes an entry. */
  readonly openSession: (sessionID: string) => void
}

/** What every tab reads: the live vltra (optimistic overrides applied), the clock, the URL. */
export type Vltra = {
  readonly view: LiveVltra
  readonly now: number
  readonly selection: SessionSelection
  readonly nav: VltraNav
}

const VltraContext = createContext<Vltra | undefined>(undefined)

export function VltraProvider({
  vltra,
  children
}: {
  readonly vltra: Vltra
  readonly children: ReactNode
}) {
  return <VltraContext value={vltra}>{children}</VltraContext>
}

export function useVltra(): Vltra {
  const vltra = useContext(VltraContext)

  if (vltra === undefined) throw new Error('useVltra needs a VltraProvider')

  return vltra
}

/** A session's URL on the current tab (its chat opens beside the tab). */
export const sessionHref = (nav: VltraNav, sessionID: string) =>
  vltraHref(nav.screen, { project: nav.project, session: sessionID, period: nav.period })
