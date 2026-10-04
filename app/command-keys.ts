import { Data } from 'effect'
import type { FleetScreen } from '@/app/fleet-href'

/**
 * Fleet's `⌘` chords: `⌘1`–`⌘9` the Nth session of Focus' list, `⌘⌥1`–`⌘⌥3` a tab, `⌘D` the open
 * session done, `⌘U` undo (the tab's `u`), `⌘I` into the chat's composer. They work everywhere but dialogs, in the OpenCode chat
 * too, even while typing.
 */
export type CommandKey = Data.TaggedEnum<{
  Session: { readonly index: number }
  Tab: { readonly screen: FleetScreen }
  Done: Record<never, never>
  Undo: Record<never, never>
  Insert: Record<never, never>
}>

export const CommandKey = Data.taggedEnum<CommandKey>()

const tabs: ReadonlyArray<FleetScreen> = ['focus', 'agents', 'projects']

type ChordEvent = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/**
 * The chord a key press makes, if any. Read by `code`, the physical key: with Option, `key` is the
 * layout's character (`¡`, `|`, `@`…). `⌘` only: `Ctrl` + digits belong to the OS, and `⌘⇧3`–`⌘⇧5`
 * are macOS screenshots, so Shift chords stay out.
 */
export const commandKey = (event: ChordEvent): CommandKey | undefined => {
  if (!event.metaKey || event.ctrlKey || event.shiftKey) return undefined

  if (event.code === 'KeyD') return event.altKey ? undefined : CommandKey.Done()

  if (event.code === 'KeyU') return event.altKey ? undefined : CommandKey.Undo()

  if (event.code === 'KeyI') return event.altKey ? undefined : CommandKey.Insert()

  const digit = /^Digit([1-9])$/.exec(event.code)?.[1]

  if (digit === undefined) return undefined

  const index = Number(digit) - 1

  if (!event.altKey) return CommandKey.Session({ index })

  const screen = tabs[index]

  return screen === undefined ? undefined : CommandKey.Tab({ screen })
}

/** A key pressed in a dialog (the launcher, a confirmation), which owns the keyboard. */
export const inDialog = (event: Pick<KeyboardEvent, 'target'>): boolean =>
  event.target instanceof Element &&
  event.target.closest('[role="dialog"], [role="alertdialog"]') !== null

/**
 * `⌘/` (`Ctrl+/` off the Mac) opens the launcher, from anywhere, in the chat too. Either the
 * physical `/` key (`code`, whatever the layout prints there) or whatever key types `/` on this
 * layout (`key`). Never `⌘K`: that is OpenCode's command palette in the chat.
 */
export const isLauncherKey = (
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  (event.key === '/' || (event.code === 'Slash' && !event.shiftKey))
