'use client'

import { Option, Schema } from 'effect'
import { useCallback, useEffect, useState } from 'react'
import { LauncherList } from '@/lib/data/fleet/types'

const decodeList = Schema.decodeUnknownOption(Schema.fromJsonString(LauncherList))

/** PR lookups still running come back `unknown`: look again this often, a few times. */
const pendingDelay = 5000

const pendingRetries = 2

/** Branches get PRs, PRs get merged: refresh the list now and then. */
const refreshEvery = 5 * 60_000

const hasPendingLookups = (list: LauncherList) =>
  list.entries.some(entry => entry.worktrees.some(worktree => worktree.pr.state === 'unknown'))

export type LauncherData = {
  /** `GET /api/fleet/launcher`, once loaded. */
  readonly list: LauncherList | undefined
  /** Load it again (opening the launcher, after a launch or a retirement). */
  readonly reload: () => void
}

/**
 * The launcher's repositories and worktrees for the whole dashboard (the palette and the Projects
 * cards): loaded on mount and on `reload`, again shortly after while PR lookups are still running,
 * and every few minutes. A failed load keeps the last list.
 */
export function useLauncherList(): LauncherData {
  const [list, setList] = useState<LauncherList>()
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(current => current + 1), [])

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const load = (retries: number) => {
      fetch('/api/fleet/launcher', { cache: 'no-store' })
        .then(response => (response.ok ? response.text() : undefined))
        .then(text => {
          const decoded = text === undefined ? Option.none() : decodeList(text)

          if (disposed || Option.isNone(decoded)) return

          setList(decoded.value)

          if (retries > 0 && hasPendingLookups(decoded.value)) {
            retry = setTimeout(() => load(retries - 1), pendingDelay)
          }
        })
        .catch(() => {
          // Fleet unreachable: keep the last list; the next reload tries again.
        })
    }

    load(pendingRetries)

    const timer = setInterval(() => load(0), refreshEvery)

    return () => {
      disposed = true
      clearTimeout(retry)
      clearInterval(timer)
    }
  }, [version])

  return { list, reload }
}
