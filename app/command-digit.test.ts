import { describe, expect, it } from 'vitest'
import { CommandDigit, commandDigit } from '@/app/command-digit'

const chord = (code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  code,
  metaKey: true,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false
})

describe('commandDigit', () => {
  it('⌘1–⌘9 pick the Nth session', () => {
    expect(commandDigit(chord('Digit1'))).toEqual(CommandDigit.Session({ index: 0 }))
    expect(commandDigit(chord('Digit9'))).toEqual(CommandDigit.Session({ index: 8 }))
  })

  it('⌘⇧1–⌘⇧3 pick a tab, by physical key whatever the layout prints', () => {
    expect(commandDigit(chord('Digit1', { shift: true }))).toEqual(CommandDigit.Tab({ screen: 'focus' }))
    expect(commandDigit(chord('Digit2', { shift: true }))).toEqual(CommandDigit.Tab({ screen: 'agents' }))
    expect(commandDigit(chord('Digit3', { shift: true }))).toEqual(CommandDigit.Tab({ screen: 'projects' }))
    expect(commandDigit(chord('Digit4', { shift: true }))).toBeUndefined()
  })

  it('leaves everything else alone: no ⌘, Ctrl or ⌥ too, 0, letters', () => {
    expect(commandDigit({ ...chord('Digit1'), metaKey: false })).toBeUndefined()
    expect(commandDigit(chord('Digit1', { ctrl: true }))).toBeUndefined()
    expect(commandDigit(chord('Digit1', { alt: true }))).toBeUndefined()
    expect(commandDigit(chord('Digit0'))).toBeUndefined()
    expect(commandDigit(chord('KeyK'))).toBeUndefined()
  })
})
