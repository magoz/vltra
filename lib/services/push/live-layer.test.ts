// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { deviceID, makePush, sendFailure } from '@/lib/services/push/live-layer'
import type { PushSender } from '@/lib/services/push/live-layer'
import { PushSendError } from '@/lib/services/push/service'
import type { BrowserSubscription, PushMessage } from '@/lib/services/push/service'

// Real files under a private temp directory; pushes go to a recording sender, never the network.
const root = mkdtempSync(path.join(tmpdir(), 'vltra-push-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

let files = 0

const freshFile = () => path.join(root, `state-${(files += 1)}`, 'push.json')

const subscription = (name: string): BrowserSubscription => ({
  endpoint: `https://push.example.com/${name}`,
  keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` }
})

const message: PushMessage = { title: 'Response ready', body: 'vltra · x', tag: 'x', url: '/' }

type Sent = { readonly endpoint: string; readonly payload: string; readonly subject: string }

/** Records what it sends; endpoints in `gone` answer 410, in `failing` 500. */
const recorder = (gone: ReadonlyArray<string> = [], failing: ReadonlyArray<string> = []) => {
  const sent: Array<Sent> = []

  const sender: PushSender = async (to, payload, vapid) => {
    if (gone.includes(to.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 })

    if (failing.includes(to.endpoint)) {
      throw Object.assign(new Error('Server error'), { statusCode: 500 })
    }

    sent.push({ endpoint: to.endpoint, payload, subject: vapid.subject })
  }

  return { sent, sender }
}

const subject = 'https://vltra.localhost'

describe('push (file-backed)', () => {
  it.effect('makes a key pair once and keeps it, readable by its owner only', () =>
    Effect.gen(function* () {
      const file = freshFile()
      const first = yield* makePush({ file, subject })
      const again = yield* makePush({ file, subject })

      expect(first.publicKey).not.toBe('')
      expect(again.publicKey).toBe(first.publicKey)
      expect(statSync(file).mode & 0o777).toBe(0o600)
    })
  )

  it.effect('saves a device once per endpoint, refreshing its label, and forgets it', () =>
    Effect.gen(function* () {
      const file = freshFile()
      const push = yield* makePush({ file, subject })

      const phone = yield* push.save(subscription('phone'), 'iPhone · app')

      yield* push.save(subscription('phone'), 'iPhone · Safari')

      expect(phone.id).toBe(deviceID(subscription('phone').endpoint))
      expect(yield* push.devices).toEqual([
        { id: phone.id, label: 'iPhone · Safari', createdAt: phone.createdAt }
      ])
      // The endpoint stays on the server: never in what Settings lists.
      expect(JSON.stringify(yield* push.devices)).not.toContain('push.example.com')

      const reread = yield* makePush({ file, subject })

      expect((yield* reread.devices).map(device => device.label)).toEqual(['iPhone · Safari'])

      yield* reread.remove(phone.id)

      expect(yield* reread.devices).toEqual([])
    })
  )

  it.effect('broadcasts to every device, dropping the ones whose subscription is gone', () =>
    Effect.gen(function* () {
      const { sent, sender } = recorder(
        [subscription('old').endpoint],
        [subscription('flaky').endpoint]
      )

      const push = yield* makePush({ file: freshFile(), subject, sender })

      yield* push.save(subscription('phone'), 'iPhone · app')
      yield* push.save(subscription('old'), 'Mac · Chrome')
      yield* push.save(subscription('flaky'), 'Mac · Safari')
      yield* push.broadcast(message)

      expect(sent).toEqual([
        { endpoint: subscription('phone').endpoint, payload: JSON.stringify(message), subject }
      ])
      expect((yield* push.devices).map(device => device.label)).toEqual([
        'iPhone · app',
        'Mac · Safari'
      ])
    })
  )

  it.effect('sends a test to one device, saying why it failed', () =>
    Effect.gen(function* () {
      const { sent, sender } = recorder([], [subscription('flaky').endpoint])
      const push = yield* makePush({ file: freshFile(), subject, sender })
      const phone = yield* push.save(subscription('phone'), 'iPhone · app')
      const flaky = yield* push.save(subscription('flaky'), 'Mac · Safari')

      yield* push.send(phone.id, message)

      expect(sent.map(item => item.endpoint)).toEqual([subscription('phone').endpoint])
      expect((yield* Effect.flip(push.send(flaky.id, message)))._tag).toBe('PushSendError')
      expect((yield* Effect.flip(push.send('nope', message)))._tag).toBe('PushDeviceNotFoundError')
    })
  )

  it.effect('starts over from a broken file, keeping it aside', () =>
    Effect.gen(function* () {
      const file = freshFile()
      const first = yield* makePush({ file, subject })

      writeFileSync(file, '{ not json')

      const push = yield* makePush({ file, subject })

      expect(push.publicKey).not.toBe(first.publicKey)
      expect(existsSync(`${file}.broken`)).toBe(true)
      expect(readFileSync(file, 'utf8')).toContain(push.publicKey)
    })
  )

  it('tells a gone subscription from a failure', () => {
    expect(sendFailure('d', { statusCode: 404 })._tag).toBe('PushDeviceNotFoundError')
    expect(sendFailure('d', { statusCode: 410 })._tag).toBe('PushDeviceNotFoundError')
    expect(sendFailure('d', { statusCode: 403, message: 'Forbidden' })).toEqual(
      new PushSendError({ deviceID: 'd', message: 'Forbidden (403)' })
    )
  })
})
