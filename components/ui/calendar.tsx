'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { DayPicker } from 'react-day-picker'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Vltra's calendar (react-day-picker, shadcn's parts) in the paper-and-ink look: mono type,
// square cells, the picked day in ink, today outlined with a hairline, no shadows or radii.
// Weeks start on Monday.

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      className={cn('w-fit font-mono text-xs [--cell-size:--spacing(8)]', className)}
      classNames={{
        months: 'relative flex flex-col',
        month: 'flex w-full flex-col gap-2',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'size-(--cell-size) p-0 aria-disabled:opacity-40'
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'size-(--cell-size) p-0 aria-disabled:opacity-40'
        ),
        month_caption: 'flex h-(--cell-size) items-center justify-center',
        caption_label: 'font-semibold select-none',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground w-(--cell-size) font-normal select-none',
        week: 'mt-0.5 flex',
        day: 'group/day size-(--cell-size) p-0 text-center select-none',
        day_button:
          'hover:bg-accent focus-visible:ring-ring/50 size-full border border-transparent tabular-nums outline-none focus-visible:ring-[3px] disabled:pointer-events-none group-data-[selected=true]/day:bg-foreground group-data-[selected=true]/day:text-background group-data-[today=true]/day:border-foreground',
        today: '',
        selected: '',
        outside: 'text-muted-foreground',
        disabled: 'text-muted-foreground opacity-40',
        hidden: 'invisible',
        ...classNames
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === 'left' ? (
            <ChevronLeftIcon aria-hidden="true" className={cn('size-3.5', chevronClass)} />
          ) : (
            <ChevronRightIcon aria-hidden="true" className={cn('size-3.5', chevronClass)} />
          )
      }}
      {...props}
    />
  )
}

export { Calendar }
