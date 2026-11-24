'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { dayAt, formatWakeTime, snoozePresets, startOfDay, wakeText } from '@/app/snooze-time'
import type { WakeTime } from '@/app/snooze-time'
import { TimeField } from '@/app/time-field'
import { sessionTitle } from '@/app/vltra-format'
import { useVltra } from '@/app/vltra-context'
import { useHandled } from '@/app/use-handled'
import { useWakeTime } from '@/app/use-wake-time'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
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
 * Snooze until: tomorrow, next Monday or a week from today (`1`–`3`) at the wake time set in
 * Settings, or a day of the calendar at a time of my own (the wake time unless changed; today
 * too, for a time still ahead).
 */
function SnoozeDialog({
  sessionID,
  onClose
}: {
  readonly sessionID: string
  readonly onClose: () => void
}) {
  const { view, now } = useVltra()
  const { snooze } = useHandled()
  const [wakeTime] = useWakeTime()
  const [day, setDay] = useState<Date>()
  const [time, setTime] = useState<WakeTime>()
  const row = view.rows.get(sessionID)
  const presets = snoozePresets(now, wakeTime)
  const picked = day === undefined ? undefined : dayAt(day, time ?? wakeTime)
  const ready = picked !== undefined && picked > now

  const choose = (until: number) => {
    snooze(sessionID, until)
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const preset = presets[Number(event.key) - 1]

    if (preset === undefined || event.target instanceof HTMLInputElement) return

    event.preventDefault()
    choose(preset.until)
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onKeyDown={onKeyDown}
        className="top-[8vh] left-1/2 w-[20rem] -translate-x-1/2 gap-3 p-4"
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
          aria-label="Pick a day and time"
          className="flex flex-col items-center gap-3 border-t pt-3"
          onSubmit={event => {
            event.preventDefault()

            if (ready) choose(picked)
          }}
        >
          <Calendar
            mode="single"
            selected={day}
            onSelect={setDay}
            today={startOfDay(now)}
            defaultMonth={startOfDay(now)}
            disabled={{ before: startOfDay(now) }}
          />
          <div className="flex w-full items-center gap-2">
            <TimeField label="Time" value={time ?? wakeTime} onChange={setTime} />
            <Button type="submit" variant="solid" className="flex-1" disabled={!ready}>
              {ready ? `Snooze until ${wakeText(picked, now)}` : 'Pick a day'}
            </Button>
          </div>
        </form>
        <p className="text-muted-foreground text-xs">
          Presets come back at {formatWakeTime(wakeTime)} (Settings). A new run of its agent brings
          it back sooner.
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
