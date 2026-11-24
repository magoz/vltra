import { describe, expect, it } from 'vitest'
import { ChatMove, chatMove, isChatRoute } from '@/app/chat-navigation'

const server = 'aHR0cHM6Ly92bHRyYS5sb2NhbGhvc3Q'

const session = (id: string, origin = 'https://vltra.localhost', key = server) =>
  `${origin}/server/${key}/session/${id}`

describe('chat route', () => {
  it("moves between sessions of the same server inside OpenCode's router", () => {
    expect(isChatRoute(session('ses_a'), session('ses_b'))).toBe(true)
  })

  it('loads the URL when the chat is not on a session of that server', () => {
    // Its first document, sign-in or any other page.
    expect(isChatRoute('about:blank', session('ses_b'))).toBe(false)
    expect(isChatRoute('https://vltra.localhost/', session('ses_b'))).toBe(false)
    expect(isChatRoute(`https://vltra.localhost/server/${server}`, session('ses_b'))).toBe(false)
    // Another server or origin.
    expect(isChatRoute(session('ses_a', undefined, 'other'), session('ses_b'))).toBe(false)
    expect(isChatRoute(session('ses_a', 'https://other.test'), session('ses_b'))).toBe(false)
    // Not a session route.
    expect(isChatRoute(session('ses_a'), `https://vltra.localhost/server/${server}`)).toBe(false)
    expect(isChatRoute(session('ses_a'), 'not a url')).toBe(false)
  })
})

describe('chat move', () => {
  const listed = (sessionID: string) => ['ses_a', 'ses_b'].includes(sessionID)

  it('follows OpenCode to another listed session (its tabs, the next tab after an archive)', () => {
    expect(chatMove(session('ses_a'), session('ses_b'), 'ses_a', listed)).toEqual(
      ChatMove.Follow({ sessionID: 'ses_b' })
    )
  })

  it("needs nothing for Vltra's own moves", () => {
    expect(chatMove(session('ses_a'), session('ses_b'), 'ses_b', listed)).toEqual(ChatMove.Stay())
    expect(chatMove('about:blank', session('ses_a'), 'ses_a', listed)).toEqual(ChatMove.Stay())
  })

  it('stays for a session Vltra does not list (a subagent, an archived one)', () => {
    expect(chatMove(session('ses_a'), session('ses_child'), 'ses_a', listed)).toEqual(
      ChatMove.Stay()
    )
  })

  it('closes when OpenCode leaves a session for its home (no tab left), only then', () => {
    expect(chatMove(session('ses_a'), 'https://vltra.localhost/', 'ses_a', listed)).toEqual(
      ChatMove.Close()
    )
    // Its first load, sign-in or any other page.
    expect(chatMove('about:blank', 'https://vltra.localhost/', 'ses_a', listed)).toEqual(
      ChatMove.Stay()
    )
    expect(
      chatMove(session('ses_a'), 'https://vltra.localhost/new-session', 'ses_a', listed)
    ).toEqual(ChatMove.Stay())
  })
})
