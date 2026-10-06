// @vitest-environment node
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { makeUsage } from '@/lib/services/usage/live-layer'
import { UsageUnavailableError } from '@/lib/services/usage/service'

// A throwaway loopback server answering like the usage dashboard.
let current: readonly [number, string] = [404, '']

const server = createServer((_request, response) => {
  response.writeHead(current[0], { 'content-type': 'application/json' }).end(current[1])
})

const decodeAddress = Schema.decodeUnknownPromise(Schema.Struct({ port: Schema.Number }))

let base = ''

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  base = `http://127.0.0.1:${(await decodeAddress(server.address())).port}`
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

/** The next answer: a status and a JSON body. */
const answer = (status: number, body: string) => {
  current = [status, body]
}

describe('UsageLive', () => {
  it.effect("reads the dashboard's accounts, extra fields ignored", () =>
    Effect.gen(function* () {
      answer(
        200,
        JSON.stringify({
          generatedAt: '2026-10-04T10:00:00.000Z',
          accounts: [
            {
              provider: 'anthropic',
              providerName: 'Claude',
              account: 'me@x.com',
              status: 'fresh',
              plan: null,
              windows: [
                {
                  id: 'weekly',
                  label: 'Weekly',
                  usedPercent: 55,
                  remainingPercent: 45,
                  resetsAt: '2026-10-09T18:00:00.000Z',
                  durationMinutes: 10080
                },
                { id: 'five-hour', label: '5-hour', remainingPercent: 100, resetsAt: null }
              ]
            },
            { provider: 'zai', providerName: 'Z.AI', account: 'key', status: 'stale', windows: [] }
          ],
          warnings: []
        })
      )

      expect(yield* makeUsage(base).accounts).toEqual([
        {
          provider: 'anthropic',
          providerName: 'Claude',
          account: 'me@x.com',
          fresh: true,
          windows: [
            {
              id: 'weekly',
              label: 'Weekly',
              remainingPercent: 45,
              durationMinutes: 10080,
              resetsAt: Date.parse('2026-10-09T18:00:00.000Z')
            },
            {
              id: 'five-hour',
              label: '5-hour',
              remainingPercent: 100,
              durationMinutes: undefined,
              resetsAt: undefined
            }
          ]
        },
        { provider: 'zai', providerName: 'Z.AI', account: 'key', fresh: false, windows: [] }
      ])
    })
  )

  it.effect('fails with UsageUnavailableError on an error status, a bad answer, or no server', () =>
    Effect.gen(function* () {
      answer(503, JSON.stringify({ error: 'down' }))

      expect(yield* Effect.flip(makeUsage(base).accounts)).toEqual(
        new UsageUnavailableError({ message: 'usage dashboard answered 503' })
      )

      answer(200, JSON.stringify({ accounts: 'nope' }))

      expect(yield* Effect.flip(makeUsage(base).accounts)).toEqual(
        new UsageUnavailableError({ message: 'usage dashboard answer unreadable' })
      )

      // Port 1 on loopback: nothing listens there.
      expect(yield* Effect.flip(makeUsage('http://127.0.0.1:1').accounts)).toEqual(
        new UsageUnavailableError({ message: 'usage dashboard unreachable' })
      )
    })
  )
})
