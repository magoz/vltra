'use client'

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { autoFocusComposer } from '@/app/chat-composer'
import { commandKey, isHelpKey, isLauncherKey } from '@/app/command-keys'

/** Typing in a field of the chat (OpenCode's composer, a search box). */
const typingSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** OpenCode's own overlays (dialogs, menus, pickers) and their keys. */
const overlaySelector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

const controlSelector = 'a, button, summary, [role="button"], [role="tab"]'

const scrollKeys: ReadonlyArray<string> = [
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  ' '
]

/**
 * Vltra's chords, which win even while typing in the chat: `⌘K` (the launcher, `isLauncherKey`;
 * OpenCode's palette stays on `⌘P` / `⌘⇧P`), `⌘/` (Vltra's keys, `isHelpKey`) and
 * `commandKey`'s (OpenCode's own `⌘1`–`⌘9` pick its tab strip's tabs, which Vltra's one-session
 * chat has no use for).
 */
const isVltraChord = (event: KeyboardEvent) =>
  isLauncherKey(event) || isHelpKey(event) || commandKey(event) !== undefined

/**
 * Whether a key pressed in the chat stays with it: while typing or in one of its overlays, the
 * scroll keys (they scroll the timeline), `Enter` on a control, and `Escape` (the chat's first;
 * unused, it leaves the chat). Elements come from the frame's realm, so `instanceof` would fail
 * here: selectors only.
 */
export const chatOwnsKey = (event: KeyboardEvent, active: Element | null): boolean => {
  if (isVltraChord(event)) return false

  if (event.isComposing || event.key === 'Escape' || scrollKeys.includes(event.key)) return true

  if (active === null) return false

  if (active.closest(typingSelector) !== null || active.closest(overlaySelector) !== null) {
    return true
  }

  return event.key === 'Enter' && active.closest(controlSelector) !== null
}

/**
 * Hands the keys pressed in the (same-origin) OpenCode chat that it does not own to Vltra: each
 * is replayed on Vltra's document, where `useKeys` and the launcher's listener see it, and when
 * Vltra takes it (`preventDefault`) the chat never does. Listens on the frame's window in the
 * capture phase, ahead of OpenCode's own document listeners (its type-to-focus composer, its
 * keybinds). An `Escape` the chat leaves unused (back on the window, not `defaultPrevented`)
 * moves focus out of the frame to Vltra, where the next `Escape` closes the session. A
 * cross-origin frame (no `contentDocument`) is left alone. Returns the cleanup; a new document in
 * the frame needs a new call.
 */
export function forwardChatKeys(frame: HTMLIFrameElement): (() => void) | undefined {
  const frameWindow = frame.contentWindow
  const frameDocument = frame.contentDocument

  if (frameWindow === null || frameDocument === null) return undefined

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || chatOwnsKey(event, frameDocument.activeElement)) return

    const replay = new KeyboardEvent('keydown', {
      key: event.key,
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      bubbles: true,
      cancelable: true
    })

    document.dispatchEvent(replay)

    if (!replay.defaultPrevented) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onUnusedEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return

    event.preventDefault()
    frame.blur()
  }

  frameWindow.addEventListener('keydown', onKey, { capture: true })
  frameWindow.addEventListener('keydown', onUnusedEscape)

  return () => {
    frameWindow.removeEventListener('keydown', onKey, { capture: true })
    frameWindow.removeEventListener('keydown', onUnusedEscape)
  }
}

/**
 * A frame whose document (not the initial `about:blank`) has loaded. Only a same-origin frame can
 * tell; a cross-origin one waits for its next `load`.
 */
const hasLoaded = (frame: HTMLIFrameElement) => {
  const frameDocument = frame.contentDocument

  return (
    frameDocument !== null &&
    frameDocument.readyState === 'complete' &&
    frameDocument.URL !== 'about:blank'
  )
}

/**
 * Whether the chat frame has loaded, with its keys forwarded to Vltra (`forwardChatKeys`) for
 * each document it loads, and its composer focused once, on the first (`autoFocusComposer`). A
 * native `load` listener, plus a check at mount: the frame comes in the server-rendered HTML and
 * can finish loading before hydration, so React's `onLoad` would miss it.
 */
export function useChatFrame(frame: RefObject<HTMLIFrameElement | null>): boolean {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const element = frame.current

    if (element === null) return

    let detach: (() => void) | undefined
    let stopFocus: (() => void) | undefined

    const attach = () => {
      setLoaded(true)
      detach?.()
      detach = forwardChatKeys(element)
      stopFocus ??= autoFocusComposer(element)
    }

    element.addEventListener('load', attach)

    if (hasLoaded(element)) attach()

    return () => {
      element.removeEventListener('load', attach)
      detach?.()
      stopFocus?.()
    }
  }, [frame])

  return loaded
}
