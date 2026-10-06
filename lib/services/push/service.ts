import { Context, Schema } from 'effect'
import type { Effect } from 'effect'
import type { PushDevice } from '@/lib/data/fleet/types'

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it (the parts sent with). */
const Key = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200))

export const BrowserSubscription = Schema.Struct({
  endpoint: Schema.String.check(Schema.isStartsWith('https://'), Schema.isMaxLength(2048)),
  keys: Schema.Struct({ p256dh: Key, auth: Key })
})

export type BrowserSubscription = typeof BrowserSubscription.Type

/**
 * What a push carries to the service worker (`public/sw.js`): the notification's title and body,
 * its tag (a later one with the same tag replaces it) and the page a tap opens.
 */
export const PushMessage = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  tag: Schema.String,
  url: Schema.String
})

export type PushMessage = typeof PushMessage.Type

/** The push file could not be written (subscriptions are kept in memory until the next write). */
export class PushStoreError extends Schema.TaggedError<PushStoreError>()('PushStoreError', {
  message: Schema.String
}) {}

/** No such device (turned off, or dropped after its push service said it is gone). */
export class PushDeviceNotFoundError extends Schema.TaggedError<PushDeviceNotFoundError>()(
  'PushDeviceNotFoundError',
  { deviceID: Schema.String }
) {}

/** The device's push service refused or could not be reached. */
export class PushSendError extends Schema.TaggedError<PushSendError>()('PushSendError', {
  deviceID: Schema.String,
  message: Schema.String
}) {}

export type PushOperations = {
  /** The VAPID public key browsers subscribe with. */
  readonly publicKey: string
  readonly devices: Effect.Effect<ReadonlyArray<PushDevice>>
  /** Adds the browser, or refreshes it (keys, label) when its endpoint is known. */
  readonly save: (
    subscription: BrowserSubscription,
    label: string
  ) => Effect.Effect<PushDevice, PushStoreError>
  /** Forgets a device; nothing to do when it is unknown. */
  readonly remove: (deviceID: string) => Effect.Effect<void, PushStoreError>
  /** To one device (Settings' test). A device its push service calls gone is dropped. */
  readonly send: (
    deviceID: string,
    message: PushMessage
  ) => Effect.Effect<void, PushDeviceNotFoundError | PushSendError>
  /** To every device, failures logged (gone devices dropped). */
  readonly broadcast: (message: PushMessage) => Effect.Effect<void>
}

/**
 * Web Push to the browsers that turned Fleet's notifications on. Their subscriptions and the VAPID
 * keys are the one thing Fleet keeps itself: nothing else knows them (DESIGN.md "Notifications").
 */
export class Push extends Context.Service<Push, PushOperations>()('@fleet/Push') {}
