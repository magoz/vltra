'use client'

import { Option, Schema } from 'effect'
import { useEffect, useRef, useState } from 'react'
import { SessionDetail } from '@/lib/data/fleet/types'

const decodeDetail = Schema.decodeUnknownOption(Schema.fromJsonString(SessionDetail))

export type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly detail: SessionDetail }

/** Wait this long after the last change before reloading, so a busy session is not hammered. */
const settleDelay = 1200

const errorMessage = (status: number) => {
  switch (status) {
    case 404:
      return 'OpenCode no longer has this session.'
    case 503:
      return 'OpenCode is not reachable right now.'
    default:
      return 'Could not load messages from OpenCode.'
  }
}

/**
 * The session panel's transcript tail and files (`GET /api/fleet/sessions/:id`). Reloads, after
 * a short settle delay, whenever `version` changes (the row's state, activity, or update time),
 * keeping the previous content on screen meanwhile.
 */
export function useSessionDetail(sessionID: string, version: string): DetailState {
  const [state, setState] = useState<{ readonly id: string; readonly value: DetailState }>({
    id: sessionID,
    value: { status: 'loading' }
  })

  // The session loaded at least once: later reloads wait for changes to settle.
  const loaded = useRef<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    const load = () =>
      fetch(`/api/fleet/sessions/${encodeURIComponent(sessionID)}`, {
        cache: 'no-store',
        signal: controller.signal
      })
        .then(async response => {
          if (!response.ok) {
            setState({
              id: sessionID,
              value: { status: 'error', message: errorMessage(response.status) }
            })

            return
          }

          const decoded = decodeDetail(await response.text())

          setState({
            id: sessionID,
            value: Option.isSome(decoded)
              ? { status: 'ready', detail: decoded.value }
              : { status: 'error', message: 'Fleet returned an unexpected response.' }
          })
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({
              id: sessionID,
              value: { status: 'error', message: 'Fleet is not reachable right now.' }
            })
          }
        })

    const timer = setTimeout(load, loaded.current === sessionID ? settleDelay : 0)

    loaded.current = sessionID

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [sessionID, version])

  return state.id === sessionID ? state.value : { status: 'loading' }
}
