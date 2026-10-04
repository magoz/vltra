import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forwardChatKeys } from '@/app/chat-keys'

/** A same-origin chat frame, and the keys that reached Fleet's document and the chat's own. */
const setup = () => {
  const frame = document.createElement('iframe')

  document.body.append(frame)

  const frameDocument = frame.contentDocument

  if (frameDocument === null) throw new Error('no frame document')

  frameDocument.body.innerHTML =
    '<textarea></textarea><button>Send</button><div role="dialog"><button>Ok</button></div>'

  const fleet: Array<string> = []
  const chat: Array<string> = []

  // Fleet takes `j` and `⌘K` (as `useKeys` and the launcher do) and leaves the rest.
  const onFleetKey = (event: KeyboardEvent) => {
    fleet.push(event.key)

    if (event.key === 'j' || (event.key === 'k' && event.metaKey)) event.preventDefault()
  }

  document.addEventListener('keydown', onFleetKey)
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
    document.removeEventListener('keydown', onFleetKey)
    frame.remove()
  }

  return { frame, frameDocument, fleet, chat, press, detach, cleanup }
}

describe('forwardChatKeys', () => {
  let chatFrame: ReturnType<typeof setup>

  beforeEach(() => {
    chatFrame = setup()
  })

  afterEach(() => chatFrame.cleanup())

  it('hands Fleet the keys it takes, which the chat then never sees', () => {
    const event = chatFrame.press('j')

    expect(chatFrame.fleet).toEqual(['j'])
    expect(chatFrame.chat).toEqual([])
    expect(event.defaultPrevented).toBe(true)
  })

  it("leaves the keys Fleet does not take to the chat (OpenCode's type-to-focus)", () => {
    const event = chatFrame.press('x')

    expect(chatFrame.fleet).toEqual(['x'])
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

    expect(chatFrame.fleet).toEqual([])
    expect(chatFrame.chat).toEqual(['ArrowDown', 'j', 'j', 'Enter'])
  })

  it('gives the chat Escape first, and an unused one moves focus out of the frame to Fleet', () => {
    chatFrame.frame.focus()

    // OpenCode uses this one (closing a menu, say).
    const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    used.preventDefault()
    chatFrame.frameDocument.dispatchEvent(used)

    expect(document.activeElement).toBe(chatFrame.frame)

    chatFrame.press('Escape')

    expect(chatFrame.fleet).toEqual([])
    expect(chatFrame.chat).toEqual(['Escape', 'Escape'])
    expect(document.activeElement).not.toBe(chatFrame.frame)
  })

  it('gives Fleet ⌘K even while typing in the chat', () => {
    const textarea = chatFrame.frameDocument.querySelector('textarea')

    if (textarea === null) throw new Error('missing fixture')

    chatFrame.press('k', textarea, { metaKey: true })

    expect(chatFrame.fleet).toEqual(['k'])
    expect(chatFrame.chat).toEqual([])
  })

  it("gives Fleet ⌘ + digits even while typing (OpenCode's tab keys never see them)", () => {
    const textarea = chatFrame.frameDocument.querySelector('textarea')

    if (textarea === null) throw new Error('missing fixture')

    const codes: Array<string> = []

    document.addEventListener('keydown', event => codes.push(event.code), { once: true })
    chatFrame.press('™', textarea, { code: 'Digit2', metaKey: true, altKey: true })

    expect(codes).toEqual(['Digit2'])
    expect(chatFrame.fleet).toEqual(['™'])
  })

  it('stops forwarding once detached', () => {
    chatFrame.detach?.()
    chatFrame.press('j')

    expect(chatFrame.fleet).toEqual([])
    expect(chatFrame.chat).toEqual(['j'])
  })
})
