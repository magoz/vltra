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
          origin: 'https://fleet.oox.sh',
          host: 'fleet.oox.sh'
        })
      )
    ).toBe(true)
  })

  it('uses the forwarded host behind the Portless proxy', () => {
    expect(
      isSameOrigin(
        request({
          origin: 'https://fleet.oox.sh',
          host: '127.0.0.1:3100',
          'x-forwarded-host': 'fleet.oox.sh'
        })
      )
    ).toBe(true)
  })

  it.each([
    { 'sec-fetch-site': 'cross-site', origin: 'https://fleet.oox.sh', host: 'fleet.oox.sh' },
    { 'sec-fetch-site': 'same-site', origin: 'https://fleet.oox.sh', host: 'fleet.oox.sh' },
    { origin: 'https://evil.example', host: 'fleet.oox.sh' },
    { host: 'fleet.oox.sh' },
    { origin: 'null', host: 'fleet.oox.sh' }
  ])('rejects cross-site or origin-less requests: case %#', headers => {
    expect(isSameOrigin(request(headers))).toBe(false)
  })

  it.effect('fails with CrossSiteRequestError', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(requireSameOrigin(request({ host: 'fleet.oox.sh' })))

      expect(error._tag).toBe('CrossSiteRequestError')
    })
  )
})
