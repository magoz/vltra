import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { isSameOrigin, requireSameOrigin } from '@/app/same-origin'

const request = (values: Readonly<Record<string, string>>) => new Headers(values)

describe('same-origin mutations', () => {
  it('accepts a same-origin browser request', () => {
    expect(
      isSameOrigin(
        request({
          'sec-fetch-site': 'same-origin',
          origin: 'https://vltra.localhost',
          host: 'vltra.localhost'
        })
      )
    ).toBe(true)
  })

  it('uses the forwarded host behind the Portless proxy', () => {
    expect(
      isSameOrigin(
        request({
          origin: 'https://vltra.localhost',
          host: '127.0.0.1:3100',
          'x-forwarded-host': 'vltra.localhost'
        })
      )
    ).toBe(true)
  })

  it.each([
    { 'sec-fetch-site': 'cross-site', origin: 'https://vltra.localhost', host: 'vltra.localhost' },
    { 'sec-fetch-site': 'same-site', origin: 'https://vltra.localhost', host: 'vltra.localhost' },
    { origin: 'https://evil.example', host: 'vltra.localhost' },
    { host: 'vltra.localhost' },
    { origin: 'null', host: 'vltra.localhost' }
  ])('rejects cross-site or origin-less requests: case %#', headers => {
    expect(isSameOrigin(request(headers))).toBe(false)
  })

  it.effect('fails with CrossSiteRequestError', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(requireSameOrigin(request({ host: 'vltra.localhost' })))

      expect(error._tag).toBe('CrossSiteRequestError')
    })
  )
})
