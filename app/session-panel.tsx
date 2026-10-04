'use client'

import { useEffect, useState } from 'react'
import { useFleet } from '@/app/fleet-context'
import { sessionTitle } from '@/app/fleet-format'
import { useFleetActions } from '@/app/fleet-actions'
import { HandledButton, ReopenButton } from '@/app/handled-button'
import { isReopenable } from '@/app/session-row'
import { StateMarker } from '@/app/state-marker'
import { Button } from '@/components/ui/button'
import { boardRow } from '@/lib/data/fleet/board'
import type { BoardRow } from '@/lib/data/fleet/board'

/**
 * Opening a session's panel marks its latest run viewed in OpenCode (its own unread dots). Fleet
 * state never depends on it.
 */
function useMarkViewed(sessionID: string, row: BoardRow['row'] | undefined) {
  const actions = useFleetActions()
  const idle = row?.idle
  const unread = idle !== undefined && (row?.viewed === undefined || row.viewed < idle)

  useEffect(() => {
    if (!unread) return

    actions.markViewed({ sessionID }).catch(() => {
      // Only OpenCode's unread dots depend on it; the next open tries again.
    })
  }, [actions, sessionID, idle, unread])
}

/**
 * OpenCode's own web UI for the session (`row.links.web`), framed. Same-site with Fleet, so a
 * browser paired once (`opencode pair`) stays signed in here; OpenCode has no embed mode, so its
 * full app chrome shows.
 */
function OpenCodeChat({ url, title }: { readonly url: string; readonly title: string }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative min-h-0 flex-1">
      {loaded ? null : (
        <div className="text-muted-foreground pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2 p-4">
          <p aria-busy="true">Loading OpenCode…</p>
          <p className="text-xs break-words">
            Not signed in? Pair this browser once:{' '}
            <code className="text-foreground">opencode pair --url {new URL(url).origin}</code>
          </p>
        </div>
      )}
      <iframe
        src={url}
        title={title}
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 block size-full border-0"
      />
    </div>
  )
}

/** Fleet's own action on the session (Handled or Reopen), then the ways out. */
function ToolbarActions({ row }: { readonly row: BoardRow['row'] }) {
  return (
    <>
      {row.state === 'finished' ? (
        <HandledButton sessionID={row.id} variant="default" size="sm" />
      ) : null}
      {isReopenable(row) ? <ReopenButton sessionID={row.id} size="sm" /> : null}
      {/* `ocb://` is handled by the Mac URL-scheme app only; touch devices cannot open it. */}
      <a
        href={row.links.terminal}
        aria-label="Open in terminal"
        title="Open in terminal"
        className="text-muted-foreground hover:text-foreground px-2 pointer-coarse:hidden"
      >
        &gt;_
      </a>
      <a
        href={row.links.web}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in new tab"
        title="Open in new tab"
        className="text-muted-foreground hover:text-foreground px-2"
      >
        ↗
      </a>
    </>
  )
}

type SessionPanelProps = {
  readonly sessionID: string
  /** The row, when the session is on the board. */
  readonly item: BoardRow | undefined
  readonly onClose: () => void
}

/**
 * A session's panel: OpenCode's chat (its web UI in an iframe) under one slim toolbar (phone back
 * button, state and title, Handled or Reopen, open in the terminal or a new tab, close). Messages,
 * asks, follow-ups and Stop all happen in the chat. It fills its container: the split beside the
 * board and Projects (`SessionSplit`), or focus mode's pane (full screen on the phone either way).
 * Callers key it by session, so a new session or closing drops the iframe.
 */
export function SessionPanel({ sessionID, item, onClose }: SessionPanelProps) {
  const row = item?.row
  const title = row === undefined ? sessionID : sessionTitle(row)

  useMarkViewed(sessionID, row)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-background flex h-10 shrink-0 items-center justify-between gap-2 border-b pr-2">
        <div className="flex min-w-0 items-center gap-2 lg:pl-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to Fleet"
            className="ml-1 lg:hidden"
            onClick={onClose}
          >
            ‹
          </Button>
          {row === undefined ? null : (
            <StateMarker state={row.state} failed={row.outcome === 'failed'} />
          )}
          <h2 className="min-w-0 truncate font-semibold">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {row === undefined ? null : <ToolbarActions row={row} />}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            className="max-lg:hidden"
            onClick={onClose}
          >
            ×
          </Button>
        </div>
      </div>
      {row === undefined ? (
        <p className="text-muted-foreground p-4">
          This session is not on the board, so Fleet has no OpenCode link for it.
        </p>
      ) : (
        <OpenCodeChat url={row.links.web} title={title} />
      )}
    </div>
  )
}

/**
 * The open session (`?session=`) docked beside a page (the board, Projects): its chat on the right
 * from `lg`, `min(52rem, 42vw)` wide, while the page narrows beside it and stays clickable; full
 * screen below `lg`. Nothing when no session is open.
 */
export function SessionSplit() {
  const { view, selection } = useFleet()
  const { selected } = selection

  if (selected === undefined) return null

  const row = view.rows.get(selected)

  return (
    <section
      aria-label="Session"
      className="bg-background flex min-h-0 min-w-0 flex-col max-lg:fixed max-lg:inset-0 max-lg:z-30 lg:w-[min(52rem,42vw)] lg:shrink-0 lg:border-l"
    >
      <SessionPanel
        key={selected}
        sessionID={selected}
        item={row === undefined ? undefined : boardRow(view, row)}
        onClose={selection.close}
      />
    </section>
  )
}
