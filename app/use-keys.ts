'use client'

import { useEffect, useRef } from 'react'
import { CommandKey, commandKey } from '@/app/command-keys'

/**
 * The dashboard's keys (desktop). Each page binds its own; the shell binds the tabs' `1`–`5`,
 * and `n`, `?`, `Escape` (`⌘K` and `⌘/` are the shell's own listeners). Keys pressed in the
 * OpenCode chat that it does not own reach here too (`forwardChatKeys`).
 */
export type VltraKey =
  | 'i'
  | 'n'
  | 'j'
  | 'k'
  | 'h'
  | 'u'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '['
  | ']'
  | '/'
  | '?'
  | 'Enter'
  | 'Escape'
  | 'ArrowDown'
  | 'ArrowUp'
  | 'ArrowLeft'
  | 'ArrowRight'

/** A key's action; undefined leaves the key alone (no `preventDefault`). */
export type KeyBindings = { readonly [Key in VltraKey]?: (() => void) | undefined }

const vltraKeys: ReadonlyArray<string> = [
  'i',
  'n',
  'j',
  'k',
  'h',
  'u',
  '1',
  '2',
  '3',
  '4',
  '5',
  '[',
  ']',
  '/',
  '?',
  'Enter',
  'Escape',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight'
]

const isVltraKey = (key: string): key is VltraKey => vltraKeys.includes(key)

const closest = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null

/** Typing in a field: every key belongs to it. */
const isTyping = (target: EventTarget | null) =>
  (target instanceof HTMLElement && target.isContentEditable) ||
  closest(target, 'input, textarea, select')

/** Enter on a link or button activates it rather than opening the focused card. */
const isControl = (target: EventTarget | null) =>
  closest(target, 'a, button, summary, [role="button"], [role="tab"]')

/** A dialog (the launcher, a confirmation) owns the keyboard while it is open. */
const inDialog = (target: EventTarget | null) =>
  closest(target, '[role="dialog"], [role="alertdialog"]')

/**
 * Listens on the document for the bound keys. Ignores keys with modifiers, inside dialogs, and
 * while typing (except `Escape`); `Enter` on a link or button is left to it. `⌘U` runs the `u`
 * binding from anywhere but dialogs, while typing too (the shell's `useCommandKeys` may have
 * taken it from the browser already).
 */
export function useKeys(bindings: KeyBindings) {
  const latest = useRef(bindings)

  useEffect(() => {
    latest.current = bindings
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const chord = commandKey(event)

      if (chord !== undefined && CommandKey.$is('Undo')(chord)) {
        const undo = latest.current.u

        if (undo === undefined || inDialog(event.target)) return

        event.preventDefault()
        undo()

        return
      }

      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return

      if (!isVltraKey(event.key) || inDialog(event.target)) return

      const run = latest.current[event.key]

      if (run === undefined) return

      if (event.key !== 'Escape' && isTyping(event.target)) return

      if (event.key === 'Enter' && isControl(event.target)) return

      event.preventDefault()
      run()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
