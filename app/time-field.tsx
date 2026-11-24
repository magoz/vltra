'use client'

import { useState } from 'react'
import { formatWakeTime, parseWakeTime } from '@/app/snooze-time'
import type { WakeTime } from '@/app/snooze-time'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A time of day typed as `HH:MM` (or `H:MM`), in Vltra's own field rather than the browser's
 * picker. `onChange` gets each valid time; an invalid draft is marked (`aria-invalid`) and goes
 * back to the last valid time when the field is left.
 */
export function TimeField({
  value,
  onChange,
  label,
  className
}: {
  readonly value: WakeTime
  readonly onChange: (time: WakeTime) => void
  readonly label: string
  readonly className?: string
}) {
  const [draft, setDraft] = useState<string>()
  const shown = draft ?? formatWakeTime(value)
  const invalid = draft !== undefined && parseWakeTime(draft) === undefined

  return (
    <Input
      aria-label={label}
      aria-invalid={invalid}
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:MM"
      maxLength={5}
      value={shown}
      onChange={event => {
        const next = event.target.value
        const time = parseWakeTime(next)

        setDraft(next)

        if (time !== undefined) onChange(time)
      }}
      onBlur={() => setDraft(undefined)}
      className={cn('w-20 text-center tabular-nums', className)}
    />
  )
}
