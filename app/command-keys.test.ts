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

  it('Ctrl+1–Ctrl+9 pick the Nth session too, and nothing else', () => {
    const ctrl = (code: string, mods: { shift?: boolean; alt?: boolean } = {}) => ({
      ...chord(code, { ...mods, ctrl: true }),
      metaKey: false
    })

    expect(commandKey(ctrl('Digit1'))).toEqual(CommandKey.Session({ index: 0 }))
    expect(commandKey(ctrl('Digit9'))).toEqual(CommandKey.Session({ index: 8 }))
    expect(commandKey(ctrl('Digit0'))).toBeUndefined()
    expect(commandKey(ctrl('Digit1', { alt: true }))).toBeUndefined()
    expect(commandKey(ctrl('Digit1', { shift: true }))).toBeUndefined()
    expect(commandKey(ctrl('KeyD'))).toBeUndefined()
    expect(commandKey(ctrl('KeyI'))).toBeUndefined()
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

  it('⌘I goes into the composer; ⌘U stays the browser’s', () => {
    expect(commandKey(chord('KeyI'))).toEqual(CommandKey.Insert())
    expect(commandKey(chord('KeyU'))).toBeUndefined()
  })

  it('leaves everything else alone: no ⌘, ⌘ with Ctrl or ⇧ (⌘⇧3 is a screenshot), 0, letters', () => {
    expect(commandKey({ ...chord('Digit1'), metaKey: false })).toBeUndefined()
    expect(commandKey(chord('Digit1', { ctrl: true }))).toBeUndefined()
    expect(commandKey(chord('Digit1', { shift: true }))).toBeUndefined()
    expect(commandKey(chord('Digit0'))).toBeUndefined()
    expect(commandKey(chord('KeyK'))).toBeUndefined()
  })
})
