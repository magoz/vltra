'use client'

import { Option, Schema } from 'effect'
import { useEffect } from 'react'
import { toast } from 'sonner'
import type { StreamStatus } from '@/app/use-vltra-live'

const decodeVersion = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ build: Schema.String }))
)

const reloadPage = () => window.location.reload()

/**
 * Whether reloading now could lose input: focus in the OpenCode chat (an iframe), a field, or an
 * open dialog (the launcher, a confirmation).
 */
const mightBeTyping = () => {
  const active = document.activeElement

  return (
    active instanceof HTMLIFrameElement ||
    (active instanceof HTMLElement && active.isContentEditable) ||
    active?.closest('input, textarea, select') != null ||
    document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
  )
}

/**
 * Reloads the page when a deploy replaced the server it came from (`build`): checked against
 * `GET /api/vltra/version` each time the event stream (re)connects, as a deploy restarts the
 * server. Hidden or idle, it reloads at once; while the user might be typing, it raises a
 * "Vltra was updated" toast with Reload and reloads the next time the page is hidden instead.
 * `reload` is replaceable for tests.
 */
export function useReloadOnDeploy(
  build: string,
  stream: StreamStatus,
  reload: () => void = reloadPage
) {
  useEffect(() => {
    if (stream !== 'live') return

    let disposed = false

    const reloadWhenHidden = () => {
      if (document.visibilityState === 'hidden') reload()
    }

    fetch('/api/vltra/version', { cache: 'no-store' })
      .then(response => (response.ok ? response.text() : undefined))
      .then(text => {
        const version = text === undefined ? Option.none() : decodeVersion(text)

        if (disposed || Option.isNone(version) || version.value.build === build) return

        if (document.visibilityState === 'hidden' || !mightBeTyping()) {
          reload()

          return
        }

        toast('Vltra was updated', {
          id: 'vltra-updated',
          duration: Number.POSITIVE_INFINITY,
          action: { label: 'Reload', onClick: reload }
        })
        document.addEventListener('visibilitychange', reloadWhenHidden)
      })
      .catch(() => {
        // Vltra unreachable: the next reconnect checks again.
      })

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', reloadWhenHidden)
    }
  }, [build, stream, reload])
}
