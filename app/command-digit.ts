import { Data } from 'effect'
import type { FleetScreen } from '@/app/fleet-href'

/** A `⌘` + digit chord: `⌘1`–`⌘9` the Nth session of Focus' list, `⌘⇧1`–`⌘⇧3` a tab. */
export type CommandDigit = Data.TaggedEnum<{
  Session: { readonly index: number }
  Tab: { readonly screen: FleetScreen }
}>

export const CommandDigit = Data.taggedEnum<CommandDigit>()

const tabs: ReadonlyArray<FleetScreen> = ['focus', 'agents', 'projects']

type ChordEvent = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/**
 * The chord a key press makes, if any. Read by `code`, the physical key: with Shift, `key` is the
 * layout's symbol (`!`, `@`, `"`…). `⌘` only: `Ctrl` + digits belong to the OS. `⌘⇧4`–`⌘⇧9` stay
 * free (`⌘⇧3`–`⌘⇧5` are macOS screenshots unless remapped).
 */
export const commandDigit = (event: ChordEvent): CommandDigit | undefined => {
  if (!event.metaKey || event.ctrlKey || event.altKey) return undefined

  const digit = /^Digit([1-9])$/.exec(event.code)?.[1]

  if (digit === undefined) return undefined

  const index = Number(digit) - 1

  if (!event.shiftKey) return CommandDigit.Session({ index })

  const screen = tabs[index]

  return screen === undefined ? undefined : CommandDigit.Tab({ screen })
}
