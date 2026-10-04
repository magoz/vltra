import { describe, expect, it } from '@effect/vitest'
import { openCodeProxyTarget, proxiedHeaders } from '@/app/opencode-proxy'

const target = new URL('http://127.0.0.1:49374')

describe('OpenCode proxy', () => {
  it('targets OPENCODE_URL, else the service loopback bind', () => {
    expect(openCodeProxyTarget('http://127.0.0.1:4100').href).toBe('http://127.0.0.1:4100/')
    expect(openCodeProxyTarget(undefined).href).toBe('http://127.0.0.1:49374/')
  })

  it("gives a same-origin request the target's origin, so OpenCode accepts its cookie", () => {
    const headers = proxiedHeaders(
      new Headers({
        'sec-fetch-site': 'same-origin',
        origin: 'https://fleet.oox.sh',
        host: '127.0.0.1:3940',
        'x-forwarded-host': 'fleet.oox.sh',
        cookie: 'opencode_session_49374=token'
      }),
      target
    )

    expect(headers.get('origin')).toBe('http://127.0.0.1:49374')
    expect(headers.get('cookie')).toBe('opencode_session_49374=token')
  })

  it.each([
    { 'sec-fetch-site': 'same-site', origin: 'https://aha.oox.sh', host: 'fleet.oox.sh' },
    { origin: 'https://evil.example', host: 'fleet.oox.sh' }
  ])('passes a foreign origin through for OpenCode to refuse: case %#', values => {
    expect(proxiedHeaders(new Headers(values), target).get('origin')).toBe(values.origin)
  })

  it('adds no origin to a request without one (plain GETs)', () => {
    const headers = proxiedHeaders(new Headers({ host: 'fleet.oox.sh' }), target)

    expect(headers.has('origin')).toBe(false)
  })
})
