import { describe, expect, it } from 'vitest'
import { isChatRoute } from '@/app/chat-navigation'

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
