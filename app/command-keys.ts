import { Data } from 'effect'
import type { FleetScreen } from '@/app/fleet-href'

/**
 * Fleet's `⌘` chords: `⌘1`–`⌘9` the Nth session of Focus' list, `⌘⌥1`–`⌘⌥4` a tab, `⌘D` the open
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

const tabs: ReadonlyArray<FleetScreen> = ['focus', 'agents', 'projects', 'stats']

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

type ShellKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>

/**
 * `⌘K` (`Ctrl+K` off the Mac) opens the launcher, from anywhere, in the chat too. Taking it from
 * the chat costs OpenCode nothing: on a session page its palette keys (`⌘K`, `⌘⇧P`) only run its
 * "open file" command, the same dialog as `⌘P`, which stays OpenCode's (v2.0.20
 * `session/composer/region.tsx`, `use-session-commands.tsx`).
 */
export const isLauncherKey = (event: ShellKeyEvent): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  !event.shiftKey &&
  (event.code === 'KeyK' || event.key.toLowerCase() === 'k')

/**
 * `⌘/` (`Ctrl+/` off the Mac) opens the tab's keys, like `?`, but also while typing in the chat
 * (Slack's and Discord's key for it; OpenCode binds none). Either the physical `/` key (`code`)
 * or whatever key types `/` on this layout (`key`; Spanish: `⇧7`).
 */
export const isHelpKey = (event: ShellKeyEvent): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  (event.key === '/' || (event.code === 'Slash' && !event.shiftKey))
