import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forwardChatKeys } from '@/app/chat-keys'

/** A same-origin chat frame, and the keys that reached Vltra's document and the chat's own. */
const setup = () => {
  const frame = document.createElement('iframe')

  document.body.append(frame)

  const frameDocument = frame.contentDocument

  if (frameDocument === null) throw new Error('no frame document')

  frameDocument.body.innerHTML =
    '<textarea></textarea><button>Send</button><div role="dialog"><button>Ok</button></div>'

  const vltra: Array<string> = []
  const chat: Array<string> = []

  // Vltra takes `j` and `⌘K` (as `useKeys` and the launcher do) and leaves the rest.
  const onVltraKey = (event: KeyboardEvent) => {
    vltra.push(event.key)

    if (event.key === 'j' || (event.key === 'k' && event.metaKey)) event.preventDefault()
  }

  document.addEventListener('keydown', onVltraKey)
  frameDocument.addEventListener('keydown', event => chat.push(event.key))

  const detach = forwardChatKeys(frame)

  /** Presses `key` on `on` (focused first), else with nothing focused in the chat. */
  const press = (key: string, on?: HTMLElement, init: KeyboardEventInit = {}) => {
    on?.focus()

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })

    ;(on ?? frameDocument).dispatchEvent(event)

    return event
  }

  const cleanup = () => {
    detach?.()
    document.removeEventListener('keydown', onVltraKey)
    frame.remove()
  }

  return { frame, frameDocument, vltra, chat, press, detach, cleanup }
}

describe('forwardChatKeys', () => {
  let chatFrame: ReturnType<typeof setup>

  beforeEach(() => {
    chatFrame = setup()
  })

  afterEach(() => chatFrame.cleanup())

  it('hands Vltra the keys it takes, which the chat then never sees', () => {
    const event = chatFrame.press('j')

    expect(chatFrame.vltra).toEqual(['j'])
    expect(chatFrame.chat).toEqual([])
    expect(event.defaultPrevented).toBe(true)
  })

  it("leaves the keys Vltra does not take to the chat (OpenCode's type-to-focus)", () => {
    const event = chatFrame.press('x')

    expect(chatFrame.vltra).toEqual(['x'])
    expect(chatFrame.chat).toEqual(['x'])
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps typing, overlays, scroll keys and Enter on a control in the chat', () => {
    const textarea = chatFrame.frameDocument.querySelector('textarea')
    const send = chatFrame.frameDocument.querySelector('button')
    const dialog = chatFrame.frameDocument.querySelector('[role="dialog"]')?.querySelector('button')

    if (!(textarea && send && dialog)) throw new Error('missing fixture')

    chatFrame.press('ArrowDown')
    chatFrame.press('j', textarea)
    chatFrame.press('j', dialog)
    chatFrame.press('Enter', send)

    expect(chatFrame.vltra).toEqual([])
    expect(chatFrame.chat).toEqual(['ArrowDown', 'j', 'j', 'Enter'])
  })

  it('gives the chat Escape first, and an unused one moves focus out of the frame to Vltra', () => {
    chatFrame.frame.focus()

    // OpenCode uses this one (closing a menu, say).
    const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    used.preventDefault()
    chatFrame.frameDocument.dispatchEvent(used)

    expect(document.activeElement).toBe(chatFrame.frame)

    chatFrame.press('Escape')

    expect(chatFrame.vltra).toEqual([])
    expect(chatFrame.chat).toEqual(['Escape', 'Escape'])
    expect(document.activeElement).not.toBe(chatFrame.frame)
  })

  it("gives Vltra ⌘K and ⌘/ even while typing; ⌘P (OpenCode's palette) stays the chat's", () => {
    const textarea = chatFrame.frameDocument.querySelector('textarea')

    if (textarea === null) throw new Error('missing fixture')

    chatFrame.press('k', textarea, { code: 'KeyK', metaKey: true })
    chatFrame.press('/', textarea, { code: 'Slash', metaKey: true })
    chatFrame.press('p', textarea, { code: 'KeyP', metaKey: true })

    // `⌘/` reaches Vltra (nothing in this fixture takes it, so the chat sees it too).
    expect(chatFrame.vltra).toEqual(['k', '/'])
    expect(chatFrame.chat).toEqual(['/', 'p'])
  })

  it("gives Vltra ⌘ + digits even while typing (OpenCode's tab keys never see them)", () => {
    const textarea = chatFrame.frameDocument.querySelector('textarea')

    if (textarea === null) throw new Error('missing fixture')

    const codes: Array<string> = []

    document.addEventListener('keydown', event => codes.push(event.code), { once: true })
    chatFrame.press('™', textarea, { code: 'Digit2', metaKey: true, altKey: true })

    expect(codes).toEqual(['Digit2'])
    expect(chatFrame.vltra).toEqual(['™'])
  })

  it('stops forwarding once detached', () => {
    chatFrame.detach?.()
    chatFrame.press('j')

    expect(chatFrame.vltra).toEqual([])
    expect(chatFrame.chat).toEqual(['j'])
  })
})
