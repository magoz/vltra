import { describe, expect, it } from 'vitest'
import { CommandKey, commandKey } from '@/app/command-keys'

const chord = (code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  code,
  metaKey: true,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false
})

describe('commandKey', () => {
  it('⌘1–⌘9 pick the Nth session', () => {
    expect(commandKey(chord('Digit1'))).toEqual(CommandKey.Session({ index: 0 }))
    expect(commandKey(chord('Digit9'))).toEqual(CommandKey.Session({ index: 8 }))
  })

  it('⌘⌥1–⌘⌥5 pick a tab, by physical key whatever the layout prints', () => {
    expect(commandKey(chord('Digit1', { alt: true }))).toEqual(CommandKey.Tab({ screen: 'focus' }))
    expect(commandKey(chord('Digit2', { alt: true }))).toEqual(CommandKey.Tab({ screen: 'agents' }))
    expect(commandKey(chord('Digit3', { alt: true }))).toEqual(
      CommandKey.Tab({ screen: 'projects' })
    )
    expect(commandKey(chord('Digit4', { alt: true }))).toEqual(CommandKey.Tab({ screen: 'stats' }))
    expect(commandKey(chord('Digit5', { alt: true }))).toEqual(
      CommandKey.Tab({ screen: 'settings' })
    )
    expect(commandKey(chord('Digit6', { alt: true }))).toBeUndefined()
  })

  it('⌘D marks the open session done (not ⌘⌥D, the macOS Dock toggle)', () => {
    expect(commandKey(chord('KeyD'))).toEqual(CommandKey.Done())
    expect(commandKey(chord('KeyD', { alt: true }))).toBeUndefined()
    expect(commandKey(chord('KeyD', { shift: true }))).toBeUndefined()
  })

  it('⌘U undoes, ⌘I goes into the composer', () => {
    expect(commandKey(chord('KeyU'))).toEqual(CommandKey.Undo())
    expect(commandKey(chord('KeyI'))).toEqual(CommandKey.Insert())
    expect(commandKey(chord('KeyU', { alt: true }))).toBeUndefined()
  })

  it('leaves everything else alone: no ⌘, Ctrl or ⇧ too (⌘⇧3 is a screenshot), 0, letters', () => {
    expect(commandKey({ ...chord('Digit1'), metaKey: false })).toBeUndefined()
    expect(commandKey(chord('Digit1', { ctrl: true }))).toBeUndefined()
    expect(commandKey(chord('Digit1', { shift: true }))).toBeUndefined()
    expect(commandKey(chord('Digit0'))).toBeUndefined()
    expect(commandKey(chord('KeyK'))).toBeUndefined()
  })
})
