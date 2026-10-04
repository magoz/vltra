'use client'

/** OpenCode's prompt editor (v2.0.20 `composer/editor/editor.tsx`), a contenteditable. */
const composerSelector = '[data-component="composer-editor"][contenteditable="true"]'

/** How long a new chat may take to show its composer before the auto-focus gives up. */
const composerWait = 15_000

// The selector matches only a contenteditable element, so the typed `querySelector` holds. The
// frame's own realm: `instanceof HTMLElement` against Fleet's window would fail.
const composerOf = (frame: HTMLIFrameElement): HTMLElement | undefined =>
  frame.contentDocument?.querySelector<HTMLElement>(composerSelector) ?? undefined

/**
 * Puts the caret at the end of the chat's composer, as OpenCode's own type-to-focus does. False
 * when there is none (a subagent's session, still loading, a cross-origin frame).
 */
export const focusComposer = (frame: HTMLIFrameElement): boolean => {
  const composer = composerOf(frame)
  const frameWindow = frame.contentWindow

  if (composer === undefined || frameWindow === null) return false

  frameWindow.focus()
  composer.focus()

  const selection = frameWindow.getSelection()

  if (selection !== null) {
    selection.selectAllChildren(composer)
    selection.collapseToEnd()
  }

  return true
}

/**
 * Whether opening a chat may take the keyboard: a desktop (a fine pointer; on a phone it would
 * pop the keyboard up), and Fleet itself is not busy with it (a field, a dialog).
 */
const mayAutoFocus = () => {
  if (!window.matchMedia('(pointer: fine)').matches) return false

  const active = document.activeElement

  return (
    active?.closest('input, textarea, select, [contenteditable="true"]') == null &&
    document.querySelector('[role="dialog"], [role="alertdialog"]') === null
  )
}

/**
 * Focuses the composer of a chat that just loaded, once it shows (OpenCode renders it after its
 * own data loads), unless `mayAutoFocus` says no then. Gives up after `composerWait`, e.g. a
 * subagent's session, which has no composer. Returns the cleanup.
 */
export const autoFocusComposer = (frame: HTMLIFrameElement): (() => void) => {
  const frameDocument = frame.contentDocument

  if (frameDocument === null) return () => undefined

  const settle = () => {
    if (composerOf(frame) === undefined) return false

    if (mayAutoFocus()) focusComposer(frame)

    return true
  }

  if (settle()) return () => undefined

  const observer = new MutationObserver(() => {
    if (settle()) stop()
  })

  const timeout = window.setTimeout(() => stop(), composerWait)

  const stop = () => {
    observer.disconnect()
    window.clearTimeout(timeout)
  }

  observer.observe(frameDocument, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['contenteditable']
  })

  return stop
}
