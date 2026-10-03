'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { LauncherEntry, LauncherList } from '@/lib/data/fleet/types'

/** What the launcher opens on: the repository picker, or a new worktree in `repo`. */
export type LauncherRequest =
  | { readonly step: 'pick' }
  | { readonly step: 'new'; readonly repo: string }

export type Launcher = {
  /** The launcher's repositories, once loaded (also decorates the Projects cards). */
  readonly list: LauncherList | undefined
  readonly open: (request?: LauncherRequest) => void
  readonly reload: () => void
}

const LauncherContext = createContext<Launcher | undefined>(undefined)

export function LauncherProvider({
  launcher,
  children
}: {
  readonly launcher: Launcher
  readonly children: ReactNode
}) {
  return <LauncherContext value={launcher}>{children}</LauncherContext>
}

export function useLauncher(): Launcher {
  const launcher = useContext(LauncherContext)

  if (launcher === undefined) throw new Error('useLauncher needs a LauncherProvider')

  return launcher
}

/** The launcher entry for an OpenCode project (by id, else by its directory). */
export const entryForProject = (
  list: LauncherList | undefined,
  projectID: string,
  directory: string | undefined
): LauncherEntry | undefined =>
  list?.entries.find(entry => entry.projectID === projectID) ??
  (directory === undefined ? undefined : list?.entries.find(entry => entry.directory === directory))
