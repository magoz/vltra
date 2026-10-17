import { Effect, Layer, Ref } from 'effect'
import type { PushDevice } from '@/lib/data/vltra/types'
import { Push, PushDeviceNotFoundError } from '@/lib/services/push/service'
import type { PushMessage } from '@/lib/services/push/service'

export type SentPush = { readonly to: string | 'all'; readonly message: PushMessage }

export type FakePush = {
  readonly layer: Layer.Layer<Push>
  /** Every message sent so far, in order. */
  readonly sent: Effect.Effect<ReadonlyArray<SentPush>>
}

/** In-memory push: devices by endpoint, messages recorded instead of sent. */
export const makeFakePush = (devices: ReadonlyArray<PushDevice> = []) =>
  Effect.gen(function* () {
    const known = yield* Ref.make<ReadonlyArray<PushDevice>>(devices)
    const sent = yield* Ref.make<ReadonlyArray<SentPush>>([])

    const layer = Layer.succeed(
      Push,
      Push.of({
        publicKey: 'BFakePublicKey',
        devices: Ref.get(known),
        save: (subscription, label) =>
          Effect.gen(function* () {
            const device: PushDevice = { id: subscription.endpoint, label, createdAt: 0 }

            yield* Ref.update(known, list => [...list.filter(d => d.id !== device.id), device])

            return device
          }),
        remove: id => Ref.update(known, list => list.filter(d => d.id !== id)),
        send: (id, message) =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(known)).some(d => d.id === id)) {
              return yield* new PushDeviceNotFoundError({ deviceID: id })
            }

            yield* Ref.update(sent, list => [...list, { to: id, message }])
          }),
        broadcast: message => Ref.update(sent, list => [...list, { to: 'all', message }])
      })
    )

    const fake: FakePush = { layer, sent: Ref.get(sent) }

    return fake
  })
