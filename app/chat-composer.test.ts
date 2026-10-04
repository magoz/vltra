import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoFocusComposer, focusComposer } from '@/app/chat-composer'

/** A same-origin chat frame; `composer` adds OpenCode's prompt editor (as it does once loaded). */
const chatFrame = () => {
  const frame = document.createElement('iframe')

  document.body.append(frame)

  const frameDocument = frame.contentDocument

  if (frameDocument === null) throw new Error('no frame document')

  const composer = () => {
    const editor = frameDocument.createElement('div')

    editor.setAttribute('data-component', 'composer-editor')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'draft'
    frameDocument.body.append(editor)

    return editor
  }

  return { frame, frameDocument, composer }
}

const pointer = (fine: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: fine && query === '(pointer: fine)' }))

beforeEach(() => pointer(true))

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('chat composer', () => {
  it('focuses the composer once it shows, caret at the end', async () => {
    const { frame, frameDocument, composer } = chatFrame()
    const stop = autoFocusComposer(frame)
    const editor = composer()

    await vi.waitFor(() => expect(frameDocument.activeElement).toBe(editor))
    expect(frame.contentWindow?.getSelection()?.focusOffset).toBe(1)
    stop()
  })

  it('leaves the keyboard alone on a phone, or while Fleet has a field focused', async () => {
    const phone = chatFrame()

    pointer(false)
    phone.composer()
    autoFocusComposer(phone.frame)

    expect(phone.frameDocument.activeElement).toBe(phone.frameDocument.body)

    pointer(true)

    const field = document.createElement('input')

    document.body.append(field)
    field.focus()

    const busy = chatFrame()

    busy.composer()
    autoFocusComposer(busy.frame)

    expect(document.activeElement).toBe(field)
  })

  it('focusComposer is false without a composer (a subagent session, still loading)', () => {
    const { frame, composer } = chatFrame()

    expect(focusComposer(frame)).toBe(false)

    composer()

    expect(focusComposer(frame)).toBe(true)
  })
})
