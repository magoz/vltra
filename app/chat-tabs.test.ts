import { Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeChatTabs, doneTabs } from '@/app/chat-tabs'
import { rowFrom } from '@/app/testing/dashboard-fixtures'
import { baseTime, sessionRecord } from '@/lib/data/vltra/testing/fixtures'

const tabsKey = 'opencode.window.browser.dat:tabs'

const server = 'https://vltra.localhost'

const Detail = Schema.Struct({
  server: Schema.String,
  directory: Schema.String,
  sessionIDs: Schema.Array(Schema.String)
})

const isDetail = Schema.is(Detail)

const isTabs = Schema.is(Schema.Array(Schema.Struct({ sessionId: Schema.String })))

const savedIDs = (): Array<string> => {
  const tabs: unknown = JSON.parse(localStorage.getItem(tabsKey) ?? '[]')

  return isTabs(tabs) ? tabs.map(tab => tab.sessionId) : []
}

/**
 * A same-origin chat frame playing OpenCode's titlebar: on `opencode:session-tabs-removed` made in
 * its own realm it drops those sessions' tabs from the saved strip, unless `deaf` (OpenCode still
 * starting).
 */
const chatFrame = (server: string, sessionIDs: ReadonlyArray<string>) => {
  const frame = document.createElement('iframe')

  document.body.append(frame)

  const frameWindow = frame.contentWindow

  const frameDocument = frame.contentDocument

  if (frameWindow === null || frameDocument === null) throw new Error('no frame document')

  // OpenCode checks `instanceof CustomEvent` against its own window: the frame's realm.
  const frameCustomEvent = Object.getPrototypeOf(frameDocument.createEvent('CustomEvent'))

  const received: Array<unknown> = []
  let listening = true

  localStorage.setItem(
    tabsKey,
    JSON.stringify(sessionIDs.map(sessionId => ({ type: 'session', server, sessionId })))
  )

  frameWindow.addEventListener('opencode:session-tabs-removed', event => {
    if (!listening || Object.getPrototypeOf(event) !== frameCustomEvent) return

    const detail = 'detail' in event ? event.detail : undefined

    received.push(detail)

    if (!isDetail(detail)) return

    const removed = new Set(detail.sessionIDs)
    const kept = savedIDs().filter(id => !removed.has(id))

    localStorage.setItem(
      tabsKey,
      JSON.stringify(kept.map(sessionId => ({ type: 'session', server, sessionId })))
    )
  })

  return {
    frame,
    frameCustomEvent,
    received,
    deaf: () => {
      listening = false
    },
    listen: () => {
      listening = true
    }
  }
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.replaceChildren()
})

describe('closeChatTabs', () => {
  it("sends OpenCode's event from the frame's realm, keyed by its origin", () => {
    const chat = chatFrame(server, ['ses_a', 'ses_b', 'ses_c'])

    closeChatTabs(chat.frame, server, ['ses_a', 'ses_c'])

    expect(chat.frameCustomEvent === CustomEvent.prototype).toBe(false)
    expect(chat.received).toEqual([{ server, directory: '', sessionIDs: ['ses_a', 'ses_c'] }])
    expect(savedIDs()).toEqual(['ses_b'])
  })

  it('sends again while OpenCode is still starting, until the tabs are gone', () => {
    const chat = chatFrame(server, ['ses_a', 'ses_b'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    chat.deaf()
    closeChatTabs(chat.frame, server, ['ses_a'])
    vi.advanceTimersByTime(500)
    chat.listen()
    vi.advanceTimersByTime(500)

    expect(savedIDs()).toEqual(['ses_b'])

    vi.advanceTimersByTime(5000)

    expect(chat.received).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns when OpenCode keeps the tabs (its event changed)', () => {
    const chat = chatFrame(server, ['ses_a'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    chat.deaf()
    closeChatTabs(chat.frame, server, ['ses_a'])
    vi.advanceTimersByTime(5000)

    expect(warn).toHaveBeenCalledExactlyOnceWith("Vltra: OpenCode kept 1 done sessions' tabs open")
  })

  it('stops checking once the chat closes', () => {
    const chat = chatFrame(server, ['ses_a'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    chat.deaf()

    const stop = closeChatTabs(chat.frame, server, ['ses_a'])

    stop()
    vi.advanceTimersByTime(5000)

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('doneTabs', () => {
  it('is the done sessions but the open one, sorted', () => {
    const done = (id: string) =>
      rowFrom(
        {
          sessions: [
            sessionRecord(id, {
              idle: baseTime + 1,
              viewed: baseTime + 1,
              outcome: 'succeeded',
              handled: baseTime + 1
            })
          ]
        },
        id
      )

    const finished = rowFrom(
      { sessions: [sessionRecord('ses_f', { idle: baseTime + 1, outcome: 'succeeded' })] },
      'ses_f'
    )

    const rows = new Map(
      [done('ses_c'), done('ses_a'), done('ses_open'), finished].map(row => [row.id, row])
    )

    expect(doneTabs(rows, 'ses_open')).toEqual(['ses_a', 'ses_c'])
  })
})
