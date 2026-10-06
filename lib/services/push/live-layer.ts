import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Clock, Config, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import { generateVAPIDKeys, sendNotification } from 'web-push'
import { openCodeWebUrl } from '@/lib/data/fleet/store'
import type { PushDevice } from '@/lib/data/fleet/types'
import {
  BrowserSubscription,
  Push,
  PushDeviceNotFoundError,
  PushSendError,
  PushStoreError
} from '@/lib/services/push/service'
import type { PushMessage } from '@/lib/services/push/service'

// Fleet's one file (DESIGN.md "Notifications"): the VAPID key pair and the subscribed browsers,
// read once when the runtime starts and rewritten whole (temp file, then rename) on every change.
// Losing it costs a new "Turn on" on each device; it never holds session state.

const StoredDevice = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  createdAt: Schema.Number,
  subscription: BrowserSubscription
})

type StoredDevice = typeof StoredDevice.Type

const VapidKeys = Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String })

type VapidKeys = typeof VapidKeys.Type

const PushFile = Schema.Struct({ vapid: VapidKeys, devices: Schema.Array(StoredDevice) })

type PushFile = typeof PushFile.Type

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(PushFile))

/**
 * The push file: `FLEET_PUSH_FILE`, else `$XDG_STATE_HOME/fleet/push.json` (`push.dev.json` under
 * `next dev`, whose throwaway sessions must not reach the real devices).
 */
export const pushFilePath = Config.all({
  file: Config.option(Config.string('FLEET_PUSH_FILE')),
  stateHome: Config.option(Config.string('XDG_STATE_HOME')),
  home: Config.string('HOME').pipe(Config.withDefault(homedir())),
  mode: Config.string('NODE_ENV').pipe(Config.withDefault('production'))
}).pipe(
  Config.map(({ file, stateHome, home, mode }) =>
    Option.getOrElse(file, () =>
      path.join(
        Option.getOrElse(stateHome, () => path.join(home, '.local', 'state')),
        'fleet',
        mode === 'development' ? 'push.dev.json' : 'push.json'
      )
    )
  )
)

/** A device's id: its endpoint (a capability URL, kept on the server) hashed. */
export const deviceID = (endpoint: string): string =>
  createHash('sha256').update(endpoint).digest('base64url').slice(0, 16)

/** The device list after `upsertDevice`, and the device it added or refreshed. */
export type Upserted = {
  readonly devices: ReadonlyArray<StoredDevice>
  readonly device: StoredDevice
}

/** Adds the subscription, or refreshes the device with its endpoint (keeping when it was added). */
export const upsertDevice = (
  devices: ReadonlyArray<StoredDevice>,
  subscription: BrowserSubscription,
  label: string,
  now: number
): Upserted => {
  const id = deviceID(subscription.endpoint)
  const known = devices.find(device => device.id === id)
  const device: StoredDevice = { id, label, createdAt: known?.createdAt ?? now, subscription }

  return {
    devices:
      known === undefined ? [...devices, device] : devices.map(d => (d.id === id ? device : d)),
    device
  }
}

const publicDevice = ({ id, label, createdAt }: StoredDevice): PushDevice => ({
  id,
  label,
  createdAt
})

/** The parts of a failure Fleet reads: Node's `code`, a `WebPushError`'s `statusCode`. */
const Failure = Schema.Struct({
  code: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String)
})

type Failure = typeof Failure.Type

const decodeFailure = Schema.decodeUnknownOption(Failure)

const failureOf = (cause: unknown): Failure =>
  Option.getOrElse(decodeFailure(cause), (): Failure => ({}))

/**
 * A failed send: 404 and 410 say the subscription is gone (the browser dropped it; it never comes
 * back), anything else may pass.
 */
export const sendFailure = (deviceID: string, cause: unknown) => {
  const failure = failureOf(cause)

  if (failure.statusCode === 404 || failure.statusCode === 410) {
    return new PushDeviceNotFoundError({ deviceID })
  }

  const status = failure.statusCode === undefined ? '' : ` (${failure.statusCode})`

  return new PushSendError({ deviceID, message: `${failure.message ?? 'Push failed'}${status}` })
}

/** Hands one encrypted message to a browser's push service. */
export type PushSender = (
  subscription: BrowserSubscription,
  payload: string,
  vapid: VapidKeys & { readonly subject: string }
) => Promise<void>

/** A "needs you" older than this is not worth waking a phone for. */
const timeToLive = 2 * 60 * 60

const webPushSender: PushSender = async (subscription, payload, vapid) => {
  await sendNotification(subscription, payload, {
    vapidDetails: vapid,
    TTL: timeToLive,
    urgency: 'high',
    timeout: 10_000
  })
}

/** Nothing usable: start over with new keys (every device turns notifications on again). */
const startOver = (file: string, reason: string) =>
  Effect.logError('Push file unusable; starting over with new keys', file, reason).pipe(
    Effect.as(Option.none<PushFile>())
  )

/** The push file; none when missing or unusable (a broken one is kept aside, `.broken`). */
const readPushFile = (file: string): Effect.Effect<Option.Option<PushFile>> =>
  Effect.tryPromise({ try: () => readFile(file, 'utf8'), catch: failureOf }).pipe(
    Effect.matchEffect({
      onFailure: failure =>
        failure.code === 'ENOENT'
          ? Effect.succeedNone
          : startOver(file, failure.message ?? 'unreadable'),
      onSuccess: text =>
        decodeFile(text).pipe(
          Effect.map(Option.some),
          Effect.catch(error =>
            Effect.tryPromise(() => rename(file, `${file}.broken`)).pipe(
              Effect.ignore,
              Effect.andThen(startOver(file, error.message))
            )
          )
        )
    })
  )

const writePushFile = (file: string, contents: PushFile) =>
  Effect.tryPromise({
    try: async () => {
      const temporary = `${file}.${process.pid}.tmp`

      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      // The private key lives here: only Fleet's user reads it.
      await writeFile(temporary, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, file)
    },
    catch: cause => new PushStoreError({ message: failureOf(cause).message ?? 'write failed' })
  })

export type PushOptions = {
  readonly file: string
  /** VAPID `sub`: Fleet's own URL. */
  readonly subject: string
  readonly sender?: PushSender
}

/**
 * Reads the push file (a new key pair, written at once, when there is none or it is unreadable),
 * then keeps it in memory; every change rewrites it, one at a time.
 */
export const makePush = (options: PushOptions) =>
  Effect.gen(function* () {
    const sender = options.sender ?? webPushSender
    const existing = yield* readPushFile(options.file)

    const initial: PushFile = Option.getOrElse(existing, () => ({
      vapid: generateVAPIDKeys(),
      devices: []
    }))

    if (Option.isNone(existing)) {
      // Written now: a browser subscribed with this key must still match it after a restart.
      yield* writePushFile(options.file, initial).pipe(
        Effect.catch(error => Effect.logError('Push file not written', error.message))
      )
    }

    const state = yield* Ref.make(initial)
    const lock = yield* Semaphore.make(1)
    const vapid = { ...initial.vapid, subject: options.subject }

    const update = <A>(change: (file: PushFile) => readonly [A, PushFile]) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const [result, next] = change(yield* Ref.get(state))

          yield* Ref.set(state, next)
          yield* writePushFile(options.file, next)

          return result
        })
      )

    const remove = (id: string) =>
      update(file => [undefined, { ...file, devices: file.devices.filter(d => d.id !== id) }])

    /** Sends; a device whose subscription is gone is dropped (and the send fails as not found). */
    const deliver = (device: StoredDevice, message: PushMessage) =>
      Effect.tryPromise({
        try: () => sender(device.subscription, JSON.stringify(message), vapid),
        catch: cause => sendFailure(device.id, cause)
      }).pipe(
        Effect.catchTag('PushDeviceNotFoundError', gone =>
          Effect.logInfo('Push subscription gone; dropping the device', device.label).pipe(
            Effect.andThen(remove(device.id)),
            Effect.catch(error => Effect.logError('Push file not written', error.message)),
            Effect.andThen(Effect.fail(gone))
          )
        )
      )

    return Push.of({
      publicKey: initial.vapid.publicKey,
      devices: Effect.map(Ref.get(state), file => file.devices.map(publicDevice)),
      save: (subscription, label) =>
        Effect.flatMap(Clock.currentTimeMillis, now =>
          update(file => {
            const next = upsertDevice(file.devices, subscription, label, now)

            return [publicDevice(next.device), { ...file, devices: next.devices }]
          })
        ),
      remove,
      send: (id, message) =>
        Effect.gen(function* () {
          const device = (yield* Ref.get(state)).devices.find(d => d.id === id)

          if (device === undefined) return yield* new PushDeviceNotFoundError({ deviceID: id })

          yield* deliver(device, message)
        }),
      broadcast: message =>
        Effect.gen(function* () {
          const { devices } = yield* Ref.get(state)

          yield* Effect.forEach(
            devices,
            device =>
              deliver(device, message).pipe(
                Effect.catchTags({
                  PushDeviceNotFoundError: () => Effect.void,
                  PushSendError: failed =>
                    Effect.logWarning('Push failed', device.label, failed.message)
                })
              ),
            { concurrency: 'unbounded', discard: true }
          )
        })
    })
  })

export const PushLive = Layer.effect(
  Push,
  Effect.gen(function* () {
    const file = yield* pushFilePath
    const web = yield* openCodeWebUrl

    return yield* makePush({ file, subject: web.origin })
  }).pipe(Effect.orDie)
)
