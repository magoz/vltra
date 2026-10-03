'use client'

import { Option, Schema } from 'effect'
import { useCallback, useState, useSyncExternalStore } from 'react'

/** The session drawer's tabs: Fleet's own panel, or OpenCode's web UI in an iframe. */
export const DrawerTab = Schema.Literals(['summary', 'chat'])

export type DrawerTab = typeof DrawerTab.Type

/** The last chosen tab, one global preference per browser. */
export const drawerTabKey = 'fleet:drawer-tab'

const decodeTab = Schema.decodeUnknownOption(DrawerTab)

const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange)

  return () => window.removeEventListener('storage', onChange)
}

// Storage can be unavailable (blocked, private mode); the preference is a nicety, so it then
// reads as unset and writes are dropped.
const readStored = (): DrawerTab | undefined => {
  try {
    return Option.getOrUndefined(decodeTab(window.localStorage.getItem(drawerTabKey)))
  } catch {
    return undefined
  }
}

const writeStored = (tab: DrawerTab) => {
  try {
    window.localStorage.setItem(drawerTabKey, tab)
  } catch {
    // Kept for this page only (see `readStored`).
  }
}

/** The server render and hydration know no preference, so both start on Summary. */
const serverSnapshot = (): DrawerTab | undefined => undefined

/**
 * The drawer's tab: this page's choice, else the browser's stored preference (read after
 * hydration), else Summary. Choosing stores it.
 */
export function useDrawerTab() {
  const stored = useSyncExternalStore(subscribe, readStored, serverSnapshot)
  const [chosen, setChosen] = useState<DrawerTab>()

  const choose = useCallback((tab: DrawerTab) => {
    setChosen(tab)
    writeStored(tab)
  }, [])

  return { tab: chosen ?? stored ?? 'summary', choose }
}
