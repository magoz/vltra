'use client'

import { Option, Schema } from 'effect'
import { useEffect, useRef, useState } from 'react'
import { applyChange, fromSnapshot } from '@/lib/data/fleet/board'
import type { LiveFleet } from '@/lib/data/fleet/board'
import { FleetChange, FleetSnapshot } from '@/lib/data/fleet/types'

/** The browser's own link to Fleet's event stream (OpenCode's status is in `live.connection`). */
export type StreamStatus = 'live' | 'reconnecting'

const decodeChange = Schema.decodeUnknownOption(Schema.fromJsonString(FleetChange))

const decodeSnapshot = Schema.decodeUnknownOption(Schema.fromJsonString(FleetSnapshot))

export type FleetLiveState = { readonly live: LiveFleet; readonly stream: StreamStatus }

/** 1s, 2s, 4s, ... capped at 30s between reconnect attempts. */
export const reconnectDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt)

const loadSnapshot = async (): Promise<Option.Option<FleetSnapshot>> => {
  const response = await fetch('/api/fleet', { cache: 'no-store' })

  if (!response.ok) return Option.none()

  return decodeSnapshot(await response.text())
}

/**
 * Keeps the fleet live: subscribes to `GET /api/fleet/events`, reloads `GET /api/fleet` after the
 * first event of every connection (so nothing falls between snapshot and stream) and whenever a
 * change mentions an unknown project, applies every other change in place, and reconnects with
 * backoff (immediately when the page becomes visible again).
 */
export function useFleetLive(initial: FleetSnapshot): FleetLiveState {
  const [live, setLive] = useState(() => fromSnapshot(initial))
  const [stream, setStream] = useState<StreamStatus>('reconnecting')
  // Projects only change with a snapshot; kept outside state so change handling can read them.
  const projects = useRef(live.projects)

  useEffect(() => {
    let source: EventSource | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let disposed = false

    const reload = () => {
      loadSnapshot()
        .then(snapshot => {
          if (disposed || Option.isNone(snapshot)) return

          const next = fromSnapshot(snapshot.value)

          projects.current = next.projects
          setLive(next)
        })
        .catch(() => {
          // The stream's error handler reconnects (and reloads) when Fleet is unreachable.
        })
    }

    const onChange = (event: MessageEvent<string>) => {
      const change = decodeChange(event.data)

      if (Option.isNone(change)) return

      if (change.value.initial) {
        attempt = 0
        setStream('live')
        reload()

        return
      }

      setLive(previous => applyChange(previous, change.value).live)

      if (change.value.rows.some(row => !projects.current.has(row.projectID))) reload()
    }

    const connect = () => {
      if (disposed) return

      clearTimeout(timer)
      source?.close()
      source = new EventSource('/api/fleet/events')
      source.addEventListener('fleet.changed', onChange)

      source.onerror = () => {
        source?.close()
        setStream('reconnecting')
        clearTimeout(timer)
        timer = setTimeout(connect, reconnectDelay(attempt))
        attempt += 1
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible' && source?.readyState !== EventSource.OPEN) {
        attempt = 0
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      clearTimeout(timer)
      source?.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return { live, stream }
}
