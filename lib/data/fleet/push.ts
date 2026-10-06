import { Effect, Schema } from 'effect'
import type { PushSettings } from '@/lib/data/fleet/types'
import { BrowserSubscription, Push } from '@/lib/services/push/service'

// Settings' notifications (DESIGN.md "Notifications"): turn a browser on or off, test it, list
// the devices. The pushes themselves come from the notifier (`notifier.ts`).

const Label = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100))

const DeviceID = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100))

export const SavePushDeviceInput = Schema.Struct({
  subscription: BrowserSubscription,
  label: Label
})

export type SavePushDeviceInput = typeof SavePushDeviceInput.Type

export const PushDeviceInput = Schema.Struct({ deviceID: DeviceID })

export type PushDeviceInput = typeof PushDeviceInput.Type

/** Turns a browser on, or refreshes it (each app open, in case its subscription changed). */
export const savePushDevice = (input: SavePushDeviceInput) =>
  Effect.flatMap(Push, push => push.save(input.subscription, input.label))

export const removePushDevice = (input: PushDeviceInput) =>
  Effect.flatMap(Push, push => push.remove(input.deviceID))

/** What Settings' test sends: shaped like the real thing, opening Settings again. */
export const testMessage = {
  title: 'Fleet notifications are on',
  body: 'Sessions that need you show up like this.',
  tag: 'fleet-test',
  url: '/?view=settings'
}

export const sendTestPush = (input: PushDeviceInput) =>
  Effect.flatMap(Push, push => push.send(input.deviceID, testMessage))

export const loadPushSettings: Effect.Effect<PushSettings, never, Push> = Effect.gen(function* () {
  const push = yield* Push

  return { publicKey: push.publicKey, devices: yield* push.devices }
})
