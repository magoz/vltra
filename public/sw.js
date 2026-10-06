// Fleet's service worker: Web Push only (DESIGN.md "Notifications"). Served at `/sw.js`, the path
// OpenCode's web UI registers its own worker at (`proxy.ts` keeps OpenCode's out): the chat iframe's
// `register('/sw.js')` finds this one already registered and changes nothing. No `fetch` handler,
// on purpose: every request (Fleet's and the proxied OpenCode's) goes straight to the network.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

const fallback = { title: 'Fleet', body: 'A session needs you', tag: 'fleet', url: '/' }

/** The push's `{ title, body, tag, url }` (`PushMessage`, from Fleet itself), or a plain one. */
const readMessage = data => {
  if (data === null) return fallback

  try {
    return { ...fallback, ...data.json() }
  } catch {
    return fallback
  }
}

// Every push shows a notification: browsers (Safari above all) revoke a subscription whose pushes
// show nothing, so whether one is worth showing is decided on the server.
self.addEventListener('push', event => {
  const message = readMessage(event.data)

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      renotify: true,
      icon: '/icon-192.png',
      data: { url: message.url }
    })
  )
})

/**
 * A tap opens what the notification is about: in an open Fleet window when there is one (it moves
 * there itself, `use-push.ts`, without a reload), else in a new one.
 */
const open = async url => {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const fleet = windows.find(client => client.frameType === 'top-level')

  if (fleet === undefined) {
    await self.clients.openWindow(url)

    return
  }

  await fleet.focus()
  fleet.postMessage({ type: 'fleet.open', url })
}

self.addEventListener('notificationclick', event => {
  event.notification.close()

  const target = new URL(event.notification.data?.url ?? '/', self.location.origin)

  event.waitUntil(open(target.origin === self.location.origin ? target.href : '/'))
})
