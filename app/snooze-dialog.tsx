'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { dayToUntil, formatWakeTime, snoozePresets, tomorrowDay, wakeText } from '@/app/snooze-time'
import { sessionTitle } from '@/app/vltra-format'
import { useVltra } from '@/app/vltra-context'
import { useHandled } from '@/app/use-handled'
import { useWakeTime } from '@/app/use-wake-time'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Opens the snooze picker for a session. */
export type SnoozePicker = { readonly pick: (sessionID: string) => void }

const SnoozeContext = createContext<SnoozePicker | undefined>(undefined)

export function useSnoozePicker(): SnoozePicker {
  const picker = useContext(SnoozeContext)

  if (picker === undefined) throw new Error('useSnoozePicker needs a SnoozeProvider')

  return picker
}

/**
 * The snooze picker for what is inside: one dialog, opened by `pick` (a card's or the toolbar's
 * Snooze, the `s` key). It snoozes through the nearest `HandledProvider`, so inside Focus the next
 * session opens, as after Done.
 */
export function SnoozeProvider({ children }: { readonly children: ReactNode }) {
  const [target, setTarget] = useState<string>()
  const picker = useMemo(() => ({ pick: (sessionID: string) => setTarget(sessionID) }), [])

  return (
    <SnoozeContext value={picker}>
      {children}
      {target === undefined ? null : (
        <SnoozeDialog sessionID={target} onClose={() => setTarget(undefined)} />
      )}
    </SnoozeContext>
  )
}

/**
 * Snooze until: tomorrow, next Monday or a week from today (`1`–`3`), or a picked day, each at
 * the wake time set in Settings.
 */
function SnoozeDialog({
  sessionID,
  onClose
}: {
  readonly sessionID: string | undefined
  readonly onClose: () => void
}) {
  const { view, now } = useVltra()
  const { snooze } = useHandled()
  const [wakeTime] = useWakeTime()
  const [day, setDay] = useState('')
  const row = sessionID === undefined ? undefined : view.rows.get(sessionID)
  const presets = snoozePresets(now, wakeTime)
  const picked = dayToUntil(day, wakeTime)

  const choose = useCallback(
    (until: number) => {
      if (sessionID !== undefined) snooze(sessionID, until)

      setDay('')
      onClose()
    },
    [sessionID, snooze, onClose]
  )

  const onKeyDown = (event: KeyboardEvent) => {
    const preset = presets[Number(event.key) - 1]

    if (preset === undefined || event.target instanceof HTMLInputElement) return

    event.preventDefault()
    choose(preset.until)
  }

  return (
    <Dialog
      open={sessionID !== undefined}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onKeyDown={onKeyDown}
        className="top-[12vh] left-1/2 w-[22rem] -translate-x-1/2 gap-3 p-4"
      >
        <DialogTitle>Snooze until</DialogTitle>
        <DialogDescription className="truncate">
          {row === undefined ? sessionID : sessionTitle(row)}
        </DialogDescription>
        <ul aria-label="When" className="flex flex-col gap-1.5">
          {presets.map((preset, index) => (
            <li key={preset.label}>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => choose(preset.until)}
              >
                <span>
                  <kbd className="text-muted-foreground mr-2">{index + 1}</kbd>
                  {preset.label}
                </span>
                <span className="text-muted-foreground">{wakeText(preset.until, now)}</span>
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault()

            if (picked !== undefined && picked > now) choose(picked)
          }}
        >
          <Input
            type="date"
            aria-label="Day"
            min={tomorrowDay(now)}
            value={day}
            onChange={event => setDay(event.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={picked === undefined || picked <= now}>
            Snooze
          </Button>
        </form>
        <p className={cn('text-muted-foreground text-xs')}>
          Back at {formatWakeTime(wakeTime)} on the day (Settings), or when its agent ends a new
          run.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** `Snooze`: opens the picker for a finished session. */
export function SnoozeButton({
  sessionID,
  size = 'default',
  className
}: {
  readonly sessionID: string
  readonly size?: 'default' | 'sm'
  readonly className?: string
}) {
  const { pick } = useSnoozePicker()

  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      title="Snooze (s)"
      onClick={() => pick(sessionID)}
    >
      Snooze
    </Button>
  )
}

/** Brings a snoozed session back now. */
export function UnsnoozeButton({
  sessionID,
  className
}: {
  readonly sessionID: string
  readonly className?: string
}) {
  const { unsnooze } = useHandled()

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('relative z-10', className)}
      onClick={() => unsnooze(sessionID)}
    >
      Wake
    </Button>
  )
}
