'use client'

import { Data, Option, Predicate, Schema } from 'effect'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FleetActionResult } from '@/app/fleet-action-result'
import type { FleetActionValue } from '@/app/fleet-action-result'
import { settled, useFleetActions } from '@/app/fleet-actions'
import type { FleetActions } from '@/app/fleet-actions'
import { PushSettings } from '@/lib/data/fleet/types'
import type { PushDevice } from '@/lib/data/fleet/types'
import { BrowserSubscription } from '@/lib/services/push/service'

// This browser's side of Fleet's notifications (DESIGN.md "Notifications"): the service worker
// (`public/sw.js`), its push subscription, and the device the server keeps for it. The browser
// owns the subscription and its permission; the server only keeps where to push.

/**
 * Whether this browser can get pushes: `install` on an iPhone or iPad outside the Home Screen app
 * (Safari only offers Web Push to installed web apps).
 */
export type PushSupport = 'supported' | 'install' | 'unsupported'

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches

const currentSupport = (): PushSupport => {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'supported'
  }

  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone() ? 'install' : 'unsupported'
}

const devicePatterns: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux']
]

const browserPatterns: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/Firefox\/|FxiOS/, 'Firefox'],
  [/Chrome\/|CriOS/, 'Chrome'],
  [/Safari\//, 'Safari']
]

const firstMatch = (patterns: ReadonlyArray<readonly [RegExp, string]>, text: string) =>
  patterns.find(([pattern]) => pattern.test(text))?.[1]

/** How Settings names a device: `iPhone · app` (the Home Screen app), `Mac · Chrome`. */
export const deviceLabel = (userAgent: string, standalone: boolean): string =>
  `${firstMatch(devicePatterns, userAgent) ?? 'Device'} · ${
    standalone ? 'app' : (firstMatch(browserPatterns, userAgent) ?? 'browser')
  }`

/** A VAPID key (URL-safe base64) as the bytes `pushManager.subscribe` takes. */
export const keyBytes = (key: string): Uint8Array<ArrayBuffer> => {
  const base64 = `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`
    .replaceAll('-', '+')
    .replaceAll('_', '/')

  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

/** Whether the subscription was made with this key (a new server key needs a new one). */
const madeWith = (subscription: PushSubscription, key: string) => {
  const own = subscription.options.applicationServerKey

  if (own === null) return false

  const expected = keyBytes(key)
  const actual = new Uint8Array(own)

  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i])
}

const decodeSubscription = Schema.decodeUnknownOption(BrowserSubscription)

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(PushSettings))

/** `GET /api/fleet/notifications`; undefined when Fleet cannot be reached. */
const loadSettings = (): Promise<PushSettings | undefined> =>
  fetch('/api/fleet/notifications', { cache: 'no-store' })
    .then(response => (response.ok ? response.text() : undefined))
    .then(text => (text === undefined ? undefined : Option.getOrUndefined(decodeSettings(text))))
    .catch(() => undefined)

/** Fleet's worker at `/`; `updateViaCache: 'none'` so a deploy's new `sw.js` is picked up. */
const registerWorker = async () => {
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })

  return await navigator.serviceWorker.ready
}

/** This browser's notifications. */
export type PushState = Data.TaggedEnum<{
  Loading: Record<never, never>
  /** `install`: on an iPhone or iPad, from the Home Screen app only. */
  Unsupported: { readonly install: boolean }
  /** The browser was told never to allow them; only its site settings can undo that. */
  Denied: Record<never, never>
  Off: Record<never, never>
  On: { readonly deviceID: string }
}>

export const PushState = Data.taggedEnum<PushState>()

/** Hands the browser's subscription to Fleet (new, or refreshed): this device. */
const saveSubscription = async (
  actions: FleetActions,
  subscription: PushSubscription
): Promise<FleetActionValue<PushDevice>> => {
  const decoded = decodeSubscription(subscription.toJSON())

  if (Option.isNone(decoded)) {
    return FleetActionResult.Error({ message: 'The browser gave an unusable subscription' })
  }

  return await settled(
    actions.savePushDevice({
      subscription: decoded.value,
      label: deviceLabel(navigator.userAgent, isStandalone())
    })
  )
}

const loading = PushState.Loading()

const off = PushState.Off()

const denied = PushState.Denied()

/** The device Fleet saved, as this browser's state (off when Fleet refused). */
const savedState = (saved: FleetActionValue<PushDevice>): PushState =>
  Predicate.isTagged(saved, 'Error') ? off : PushState.On({ deviceID: saved.value.id })

/**
 * Where this browser stands, telling Fleet its subscription again when it has one: a browser may
 * renew it on its own (Safari after a while), and only an app open says so. A subscription made
 * with another key (the server's push file was lost) is dropped: it can no longer be pushed to.
 */
const syncDevice = async (actions: FleetActions, publicKey: string): Promise<PushState> => {
  if (currentSupport() !== 'supported') return off

  if (Notification.permission === 'denied') return denied

  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = (await registration?.pushManager.getSubscription()) ?? null

  if (subscription === null || Notification.permission !== 'granted') return off

  if (!madeWith(subscription, publicKey)) {
    await subscription.unsubscribe()

    return off
  }

  return savedState(await saveSubscription(actions, subscription))
}

/**
 * On every app open (the shell): refreshes this browser's subscription when notifications are on,
 * so a renewed one keeps getting pushes. Quiet: Settings shows what went wrong.
 */
export function usePushRefresh() {
  const actions = useFleetActions()

  useEffect(() => {
    if (currentSupport() !== 'supported' || Notification.permission !== 'granted') return

    void loadSettings()
      .then(settings =>
        settings === undefined ? undefined : syncDevice(actions, settings.publicKey)
      )
      .catch(() => undefined)
  }, [actions])
}

const OpenMessage = Schema.Struct({ type: Schema.Literal('fleet.open'), url: Schema.String })

const decodeOpenMessage = Schema.decodeUnknownOption(OpenMessage)

/**
 * A tapped notification in an open Fleet window (`sw.js` focuses it and says where): moves there
 * like any other move, a history entry Next syncs into the URL state, without a reload.
 */
export function useOpenFromNotification() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const container = navigator.serviceWorker

    const onMessage = (event: MessageEvent) => {
      const message = decodeOpenMessage(event.data)

      if (Option.isNone(message)) return

      const target = new URL(message.value.url, window.location.origin)

      if (target.origin !== window.location.origin) return

      window.history.pushState(null, '', `${target.pathname}${target.search}`)
    }

    container.addEventListener('message', onMessage)

    return () => container.removeEventListener('message', onMessage)
  }, [])
}

export type Push = {
  readonly state: PushState
  /** The key and the devices; undefined until loaded (or when Fleet cannot be reached). */
  readonly settings: PushSettings | undefined
  /** A change is running (the buttons wait). */
  readonly busy: boolean
  /** Asks the browser, subscribes, and tells Fleet. From a click: Safari asks only then. */
  readonly turnOn: () => void
  readonly turnOff: () => void
  readonly test: () => void
  /** Stops pushes to another device (this one turns off with `turnOff`). */
  readonly removeDevice: (deviceID: string) => void
}

/** A change's outcome: nothing went wrong, or what did (the toast's description). */
type Problem = string | undefined

const problemOf = (result: FleetActionResult | FleetActionValue<unknown>): Problem =>
  Predicate.isTagged(result, 'Error') ? result.message : undefined

/** Settings' notifications: this browser's state, the devices, and the changes. */
export function usePush(): Push {
  const actions = useFleetActions()
  const [state, setState] = useState<PushState>(loading)
  const [settings, setSettings] = useState<PushSettings>()
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const loaded = await loadSettings()

    if (loaded !== undefined) setSettings(loaded)
  }, [])

  useEffect(() => {
    let disposed = false

    const support = currentSupport()

    const load = async () => {
      if (support !== 'supported') {
        setState(PushState.Unsupported({ install: support === 'install' }))
        await reload()

        return
      }

      // Registered up front, so a later "Turn on" subscribes without waiting.
      await registerWorker()

      const loaded = await loadSettings()
      const next = loaded === undefined ? off : await syncDevice(actions, loaded.publicKey)

      if (disposed) return

      setState(next)
      await reload()
    }

    void load().catch(() => {
      if (!disposed) setState(off)
    })

    return () => {
      disposed = true
    }
  }, [actions, reload])

  const run = useCallback(
    (failure: string, change: () => Promise<Problem>) => {
      setBusy(true)
      change()
        .catch(() => 'The browser refused')
        .then(problem => {
          if (problem !== undefined) toast.error(failure, { description: problem })
        })
        .finally(() => {
          setBusy(false)
          void reload()
        })
    },
    [reload]
  )

  const turnOn = useCallback(() => {
    if (settings === undefined) return

    // First, before anything else is awaited: Safari only asks within the click.
    const asked = Notification.requestPermission()

    run('Could not turn notifications on', async () => {
      const permission = await asked

      if (permission !== 'granted') {
        setState(permission === 'denied' ? denied : off)

        return undefined
      }

      const registration = await registerWorker()
      const existing = await registration.pushManager.getSubscription()
      const reusable = existing !== null && madeWith(existing, settings.publicKey)

      if (existing !== null && !reusable) await existing.unsubscribe()

      const subscription = reusable
        ? existing
        : await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(settings.publicKey)
          })

      const saved = await saveSubscription(actions, subscription)

      setState(savedState(saved))

      return problemOf(saved)
    })
  }, [actions, run, settings])

  const turnOff = useCallback(() => {
    if (!PushState.$is('On')(state)) return

    const { deviceID } = state

    run('Could not turn notifications off', async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = (await registration?.pushManager.getSubscription()) ?? null

      await subscription?.unsubscribe()
      setState(off)

      return problemOf(await settled(actions.removePushDevice({ deviceID })))
    })
  }, [actions, run, state])

  const test = useCallback(() => {
    if (!PushState.$is('On')(state)) return

    const { deviceID } = state

    run('Could not send a test', async () => {
      const problem = problemOf(await settled(actions.testPush({ deviceID })))

      if (problem === undefined) toast.success('Test sent')

      return problem
    })
  }, [actions, run, state])

  const removeDevice = useCallback(
    (deviceID: string) =>
      run('Could not remove the device', async () =>
        problemOf(await settled(actions.removePushDevice({ deviceID })))
      ),
    [actions, run]
  )

  return { state, settings, busy, turnOn, turnOff, test, removeDevice }
}
