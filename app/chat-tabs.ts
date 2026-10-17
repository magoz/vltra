'use client'

import { Option, Schema } from 'effect'
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useVltra } from '@/app/vltra-context'
import type { VltraRow } from '@/lib/data/vltra/types'

/**
 * OpenCode's own window event for sessions whose tabs are gone (v2.0.22
 * `shell/titlebar/session-events.ts`; it sends it after a delete). Its titlebar answers with
 * `tabs.removeSessions`: the tabs leave the tab strip and the closed-tab history, saved the usual
 * way. Nothing public closes a tab, and OpenCode's server knows nothing of them (they live in the
 * browser's localStorage).
 */
const tabsRemovedEvent = 'opencode:session-tabs-removed'

/** Where OpenCode's web UI saves its tab strip (`Persist.window("tabs")`). Vltra only reads it. */
const tabsKey = 'opencode.window.browser.dat:tabs'

/** OpenCode saves its tab strip 100 ms after a change; Vltra reads it back after this. */
const checkDelay = 500

/** Sends while tabs stay: a chat that just loaded may not listen yet (its titlebar mounts late). */
const attempts = 5

const SessionTab = Schema.Struct({
  type: Schema.Literal('session'),
  server: Schema.String,
  sessionId: Schema.String
})

const isSessionTab = Schema.is(SessionTab)

const decodeTabs = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)))

/**
 * The sessions among `sessionIDs` that still have a tab in OpenCode's saved strip, `None` when the
 * strip is not what Vltra expects (OpenCode changed it).
 */
const savedTabs = (
  server: string,
  sessionIDs: ReadonlySet<string>
): Option.Option<Array<string>> => {
  const raw = localStorage.getItem(tabsKey)

  if (raw === null) return Option.some([])

  return Option.map(decodeTabs(raw), tabs =>
    tabs.flatMap(tab =>
      isSessionTab(tab) && tab.server === server && sessionIDs.has(tab.sessionId)
        ? [tab.sessionId]
        : []
    )
  )
}

/**
 * Sends `tabsRemovedEvent` into a (same-origin) chat frame; false when it has no document of its
 * own to send it to (cross-origin, gone). The event is made in the frame's realm: OpenCode checks
 * `instanceof CustomEvent` against its own window.
 */
const sendTabsRemoved = (
  frame: HTMLIFrameElement,
  server: string,
  sessionIDs: ReadonlyArray<string>
): boolean => {
  const frameWindow = frame.contentWindow
  const frameDocument = frame.contentDocument

  if (frameWindow === null || frameDocument === null) return false

  const event = frameDocument.createEvent('CustomEvent')

  // OpenCode requires a `directory` string and ignores it.
  event.initCustomEvent(tabsRemovedEvent, false, false, {
    server,
    directory: '',
    sessionIDs: [...sessionIDs]
  })
  frameWindow.dispatchEvent(event)

  return true
}

/**
 * Closes the given sessions' tabs in the chat's OpenCode tab strip, through OpenCode's own event
 * (`tabsRemovedEvent`). `server` is OpenCode's key for its server: the origin that serves the chat
 * (`openCodeWebSessionUrl`). Reads
 * the saved strip back after `checkDelay`: sends again for tabs that stayed (OpenCode was still
 * starting), and after `attempts` warns that OpenCode no longer answers the event as Vltra expects.
 * Returns the cleanup.
 */
export function closeChatTabs(
  frame: HTMLIFrameElement,
  server: string,
  sessionIDs: ReadonlyArray<string>
): () => void {
  let timer: number | undefined

  const attempt = (pending: ReadonlyArray<string>, left: number) => {
    if (!sendTabsRemoved(frame, server, pending)) return

    timer = window.setTimeout(() => {
      Option.match(savedTabs(server, new Set(pending)), {
        onNone: () =>
          console.warn(`Vltra: OpenCode's saved tabs (${tabsKey}) are not what Vltra expects`),
        onSome: stayed => {
          if (stayed.length === 0) return

          if (left > 1) attempt(stayed, left - 1)
          else console.warn(`Vltra: OpenCode kept ${stayed.length} done sessions' tabs open`)
        }
      })
    }, checkDelay)
  }

  if (sessionIDs.length > 0) attempt(sessionIDs, attempts)

  return () => window.clearTimeout(timer)
}

/** Done (handled) sessions other than the open one, sorted: the tabs the chat should not keep. */
export const doneTabs = (rows: ReadonlyMap<string, VltraRow>, open: string): Array<string> =>
  Array.from(rows.values())
    .flatMap(row => (row.state === 'handled' && row.id !== open ? [row.id] : []))
    .sort()

/**
 * Keeps done sessions out of the chat's OpenCode tab strip (Vltra opens every session in it, so
 * each leaves a tab): closes them all once the chat loads, and again whenever the done set changes
 * (Done here, or on another computer). The open session keeps its tab, even when done: closing it
 * would move the chat to another tab. Every browser has its own strip, so each cleans its own.
 */
export function useCloseDoneTabs(
  frame: RefObject<HTMLIFrameElement | null>,
  loaded: boolean,
  open: string,
  url: string
) {
  const { view } = useVltra()
  const server = new URL(url).origin
  // A string, so the effect runs only when the set changes, not on every snapshot.
  const done = doneTabs(view.rows, open).join('\n')

  useEffect(() => {
    const element = frame.current

    if (!loaded || element === null || done === '') return

    return closeChatTabs(element, server, done.split('\n'))
  }, [frame, loaded, server, done])
}
