import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readJsonRequest } from '@/app/api/fleet/json-request'

const request = (headers: HeadersInit) =>
  new Request('https://fleet.oox.sh/api/fleet/launcher/branch', {
    method: 'POST',
    headers,
    body: '{"task":"x"}'
  })

const plugin = {
  origin: 'https://fleet.oox.sh',
  host: 'fleet.oox.sh',
  'content-type': 'application/json; charset=utf-8'
}

describe('readJsonRequest', () => {
  it.effect("gives a same-origin JSON request's body", () =>
    Effect.gen(function* () {
      expect(yield* readJsonRequest(request(plugin))).toBe('{"task":"x"}')
    })
  )

  it.effect('checks the origin first, then the content type', () =>
    Effect.gen(function* () {
      const crossSite = yield* Effect.flip(
        readJsonRequest(request({ ...plugin, origin: 'https://evil.example', 'content-type': '' }))
      )

      const notJson = yield* Effect.flip(
        readJsonRequest(request({ ...plugin, 'content-type': 'text/plain' }))
      )

      expect(crossSite._tag).toBe('CrossSiteRequestError')
      expect(notJson._tag).toBe('NotJsonError')
    })
  )
})
