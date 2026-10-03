'use client'

import { useEffect, useRef } from 'react'

/** The dashboard's keys (desktop): `j`/`k`, `Enter`, `h`, `u`, `a`/`d`, and `Escape`. */
export type FleetKeys = {
  readonly next: () => void
  readonly previous: () => void
  readonly open: () => void
  readonly handled: () => void
  readonly undo: () => void
  readonly approve: () => void
  readonly deny: () => void
  readonly close: () => void
}

const closest = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null

/** Typing in a field: every key belongs to it. */
const isTyping = (target: EventTarget | null) =>
  (target instanceof HTMLElement && target.isContentEditable) ||
  closest(target, 'input, textarea, select')

/** Enter on a link or button activates it rather than opening the focused row. */
const isControl = (target: EventTarget | null) =>
  closest(target, 'a, button, summary, [role="button"], [role="tab"]')

/** A dialog (the Interrupt confirmation) owns the keyboard while it is open. */
const inDialog = (target: EventTarget | null) =>
  closest(target, '[role="dialog"], [role="alertdialog"]')

const letterKey = (keys: FleetKeys, key: string): (() => void) | undefined => {
  switch (key) {
    case 'j':
      return keys.next
    case 'k':
      return keys.previous
    case 'h':
      return keys.handled
    case 'u':
      return keys.undo
    case 'a':
      return keys.approve
    case 'd':
      return keys.deny
    default:
      return undefined
  }
}

/** Listens on the document; ignores keys with modifiers, while typing, and inside dialogs. */
export function useFleetKeys(keys: FleetKeys) {
  const latest = useRef(keys)

  useEffect(() => {
    latest.current = keys
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return

      if (inDialog(event.target)) return

      if (event.key === 'Escape') {
        latest.current.close()

        return
      }

      if (isTyping(event.target)) return

      if (event.key === 'Enter') {
        if (isControl(event.target)) return

        event.preventDefault()
        latest.current.open()

        return
      }

      const run = letterKey(latest.current, event.key)

      if (run === undefined) return

      event.preventDefault()
      run()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
