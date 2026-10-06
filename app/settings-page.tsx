'use client'

import { useFleet } from '@/app/fleet-context'
import { relativeTime } from '@/app/fleet-format'
import { PushState, usePush } from '@/app/use-push'
import type { Push } from '@/app/use-push'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Status = { readonly label: string; readonly detail: string; readonly on: boolean }

/** This browser's notifications in words: a status, then what to do about it. */
export const pushStatus = PushState.$match({
  Loading: (): Status => ({ label: 'Checking…', detail: '', on: false }),
  Unsupported: ({ install }): Status =>
    install
      ? {
          label: 'Not in Safari',
          detail:
            'On an iPhone or iPad, notifications come to the Home Screen app: Share → Add to Home Screen, then open Fleet from there.',
          on: false
        }
      : { label: 'Not available', detail: 'This browser cannot get notifications.', on: false },
  Denied: (): Status => ({
    label: 'Blocked',
    detail:
      "The browser was told not to allow Fleet's notifications. Allow them in its site settings (on an iPhone: Settings → Notifications → Fleet), then come back.",
    on: false
  }),
  Off: (): Status => ({
    label: 'Off on this device',
    detail: 'Turn them on to hear about sessions that need you while Fleet is not in front of you.',
    on: false
  }),
  On: (): Status => ({ label: 'On for this device', detail: '', on: true })
})

/** This browser: its status and the buttons for it. */
function ThisDevice({ push }: { readonly push: Push }) {
  const status = pushStatus(push.state)
  const ready = push.settings !== undefined && !push.busy

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-2 rounded-full',
            status.on ? 'bg-attention' : 'border-muted-foreground border'
          )}
        />
        <span className={cn('font-semibold', status.on && 'text-attention')}>{status.label}</span>
      </p>
      {status.detail === '' ? null : <p className="text-muted-foreground">{status.detail}</p>}
      <div className="flex flex-wrap gap-2">
        {PushState.$is('Off')(push.state) ? (
          <Button onClick={push.turnOn} disabled={!ready}>
            Turn on
          </Button>
        ) : null}
        {PushState.$is('On')(push.state) ? (
          <>
            <Button variant="outline" onClick={push.test} disabled={!ready}>
              Send a test
            </Button>
            <Button variant="outline" onClick={push.turnOff} disabled={!ready}>
              Turn off
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** Every device that gets pushes, this one marked; the others can be removed from here. */
function Devices({ push, now }: { readonly push: Push; readonly now: number }) {
  const devices = push.settings?.devices ?? []
  const current = PushState.$is('On')(push.state) ? push.state.deviceID : undefined

  if (devices.length === 0) {
    return <p className="text-muted-foreground">No device gets notifications yet.</p>
  }

  return (
    <ul aria-label="Devices" className="border-t">
      {devices.map(device => (
        <li key={device.id} className="flex min-h-10 items-center gap-3 border-b py-1.5">
          <span className="min-w-0 flex-1 truncate">
            {device.label}
            {device.id === current ? (
              <span className="text-muted-foreground"> · this device</span>
            ) : null}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs">
            added {relativeTime(device.createdAt, now)} ago
          </span>
          {device.id === current ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={push.busy}
              onClick={() => push.removeDevice(device.id)}
              aria-label={`Remove ${device.label}`}
            >
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Settings (`?view=settings`): Fleet's notifications (DESIGN.md "Notifications"). Each browser
 * turns them on for itself; the list shows every device the server pushes to.
 */
export function SettingsPage() {
  const { now } = useFleet()
  const push = usePush()

  return (
    <div className="min-h-0 flex-1 lg:overflow-y-auto">
      <h2 className="sr-only">Settings</h2>
      <div className="flex max-w-2xl flex-col gap-3 p-3 lg:p-4">
        <section aria-labelledby="settings-notifications" className="bg-background border">
          <h3 id="settings-notifications" className="border-b px-3 py-2 font-semibold">
            Notifications
          </h3>
          <div className="flex flex-col gap-5 p-3">
            <ThisDevice push={push} />
            <p className="text-muted-foreground text-xs">
              A session blocked on a permission or a question for 45 seconds, or a run that ended 2
              minutes ago and that you have not opened or marked done. Several at once come as one.
            </p>
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold">Devices</h4>
              <Devices push={push} now={now} />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
