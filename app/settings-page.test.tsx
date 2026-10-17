import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeActions, TestDashboard } from '@/app/testing/dashboard-fixtures'
import type { ActionCall } from '@/app/testing/dashboard-fixtures'
import { vltraLive, now } from '@/app/testing/vltra-scenario'
import { deviceLabel, keyBytes } from '@/app/use-push'
import type { PushDevice } from '@/lib/data/vltra/types'

const publicKey = 'BFakeKey'

const endpoint = 'https://push.example.com/this-browser'

let devices: ReadonlyArray<PushDevice> = []

const fetchSettings = vi.fn((input: RequestInfo | URL) =>
  Promise.resolve(
    String(input) === '/api/vltra/notifications'
      ? Response.json({ publicKey, devices })
      : new Response(null, { status: 404 })
  )
)

/** A browser's push subscription, made with `key`. */
class FakeSubscription {
  readonly endpoint = endpoint
  readonly options: { readonly applicationServerKey: ArrayBuffer }
  readonly #browser: FakeBrowser

  constructor(browser: FakeBrowser, key: Uint8Array<ArrayBuffer>) {
    this.#browser = browser
    this.options = { applicationServerKey: key.slice().buffer }
  }

  toJSON() {
    return { endpoint, expirationTime: null, keys: { p256dh: 'p256dh', auth: 'auth' } }
  }

  unsubscribe() {
    this.#browser.subscription = null

    return Promise.resolve(true)
  }
}

/** Service worker, push manager and notification permission, as a browser that has them. */
class FakeBrowser {
  subscription: FakeSubscription | null = null
  permission: NotificationPermission
  readonly #answer: NotificationPermission

  constructor(permission: NotificationPermission, answer: NotificationPermission = 'granted') {
    this.permission = permission
    this.#answer = answer
  }

  readonly registration = {
    pushManager: {
      getSubscription: () => Promise.resolve(this.subscription),
      subscribe: (options: { readonly applicationServerKey: Uint8Array<ArrayBuffer> }) => {
        this.subscription = new FakeSubscription(this, options.applicationServerKey)

        return Promise.resolve(this.subscription)
      }
    }
  }

  install() {
    const registration = Promise.resolve(this.registration)
    const permission = () => this.permission

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: () => registration,
        ready: registration,
        getRegistration: () => registration,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }
    })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.stubGlobal('Notification', {
      get permission() {
        return permission()
      },
      requestPermission: () => {
        this.permission = this.#answer

        return Promise.resolve(this.#answer)
      }
    })
  }
}

const renderSettings = (actions = fakeActions()) => {
  render(<TestDashboard live={vltraLive()} now={now} actions={actions.actions} screen="settings" />)

  return actions
}

const pushCalls = (calls: ReadonlyArray<ActionCall>) =>
  calls.filter(call => ['savePushDevice', 'removePushDevice', 'testPush'].includes(call.action))

const section = () => screen.getByRole('region', { name: 'Notifications' })

/** The button, once it can be pressed (the key has loaded). */
const enabledButton = async (name: string) => {
  const button = await within(section()).findByRole('button', { name })

  await waitFor(() => expect(button).toHaveProperty('disabled', false))

  return button
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  devices = []
})

describe('settings: notifications', () => {
  it('turns them on from a click: asks, subscribes, and tells Vltra; then tests and turns off', async () => {
    new FakeBrowser('default').install()
    vi.stubGlobal('fetch', fetchSettings)

    const { calls } = renderSettings()
    const on = await enabledButton('Turn on')

    expect(within(section()).getByRole('status').textContent).toBe('Off on this device')

    fireEvent.click(on)

    await within(section()).findByText('On for this device')
    expect(pushCalls(calls)).toEqual([
      {
        action: 'savePushDevice',
        input: {
          subscription: { endpoint, keys: { p256dh: 'p256dh', auth: 'auth' } },
          label: deviceLabel(navigator.userAgent, false)
        }
      }
    ])

    fireEvent.click(await enabledButton('Send a test'))
    await waitFor(() =>
      expect(pushCalls(calls).at(-1)).toEqual({
        action: 'testPush',
        input: { deviceID: 'device-1' }
      })
    )

    fireEvent.click(await enabledButton('Turn off'))
    await within(section()).findByText('Off on this device')
    expect(pushCalls(calls).at(-1)).toEqual({
      action: 'removePushDevice',
      input: { deviceID: 'device-1' }
    })
  })

  it('stays off when the browser is not allowed to ask', async () => {
    new FakeBrowser('default', 'denied').install()
    vi.stubGlobal('fetch', fetchSettings)

    const { calls } = renderSettings()

    fireEvent.click(await enabledButton('Turn on'))

    await within(section()).findByText('Blocked')
    expect(pushCalls(calls)).toEqual([])
  })

  it('lists the devices that get them, this one marked, the others removable', async () => {
    const browser = new FakeBrowser('granted')

    browser.install()
    await browser.registration.pushManager.subscribe({ applicationServerKey: keyBytes(publicKey) })
    devices = [
      { id: 'device-1', label: 'Mac · Chrome', createdAt: now - 3 * 60 * 60 * 1000 },
      { id: 'phone', label: 'iPhone · app', createdAt: now - 2 * 24 * 60 * 60 * 1000 }
    ]
    vi.stubGlobal('fetch', fetchSettings)

    const { calls } = renderSettings()
    const list = await within(section()).findByRole('list', { name: 'Devices' })

    await within(list).findByText('· this device')
    expect(within(list).getByText('added 2d ago')).toBeTruthy()
    expect(within(list).queryByRole('button', { name: 'Remove Mac · Chrome' })).toBeNull()

    fireEvent.click(within(list).getByRole('button', { name: 'Remove iPhone · app' }))
    await waitFor(() =>
      expect(pushCalls(calls).at(-1)).toEqual({
        action: 'removePushDevice',
        input: { deviceID: 'phone' }
      })
    )
  })

  it('says where they work when this browser cannot get them', async () => {
    vi.stubGlobal('fetch', fetchSettings)
    renderSettings()

    expect(await within(section()).findByText('Not available')).toBeTruthy()
    expect(within(section()).queryByRole('button', { name: 'Turn on' })).toBeNull()
  })
})

describe('device label', () => {
  it('names the device and the browser, or the Home Screen app', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        true
      )
    ).toBe('iPhone · app')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        false
      )
    ).toBe('Mac · Chrome')
  })
})
