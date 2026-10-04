import { describe, expect, it } from '@effect/vitest'
import { openCodeWebSessionUrl, sessionLinks } from '@/lib/data/fleet/links'

describe('OpenCode web deep link', () => {
  it('encodes the page origin as unpadded base64url (verified live on Box)', () => {
    expect(openCodeWebSessionUrl(new URL('https://fleet.oox.sh'), 'ses_abc')).toBe(
      'https://fleet.oox.sh/server/aHR0cHM6Ly9mbGVldC5vb3guc2g/session/ses_abc'
    )
  })

  it('keys the server by origin only, whatever path the base URL has', () => {
    const url = openCodeWebSessionUrl(new URL('https://example.test:8443/some/path/'), 'ses_1')

    expect(url).toBe(
      `https://example.test:8443/server/${btoa('https://example.test:8443').replaceAll('=', '')}/session/ses_1`
    )
  })

  it('builds terminal and command fallbacks', () => {
    expect(sessionLinks(new URL('https://example.test'), 'ses_1')).toMatchObject({
      terminal: 'ocb://session/ses_1',
      command: 'ocb -s ses_1'
    })
  })
})
