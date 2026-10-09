'use client'

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Fleet's combobox (Base UI, shadcn's parts), in the paper-and-ink look: hairline border, no
// shadow. Shaped as a searchable select: a trigger button showing the value, and a popup with the
// search field on top of the list (Base UI's "input inside popup"). The project filter uses it.

const Combobox = ComboboxPrimitive.Root

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.Label.Props) {
  return (
    <ComboboxPrimitive.Label
      data-slot="combobox-label"
      className={cn('text-muted-foreground text-xs', className)}
      {...props}
    />
  )
}

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        'border-input bg-background text-foreground hover:bg-accent data-popup-open:bg-accent focus-visible:ring-ring/50 data-placeholder:text-muted-foreground flex h-10 min-w-0 items-center justify-between gap-2 border pr-1.5 pl-2.5 font-mono text-sm whitespace-nowrap outline-none select-none focus-visible:ring-[3px] md:h-7 md:pl-2 md:text-xs',
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ComboboxPrimitive.Icon className="text-muted-foreground flex shrink-0">
        <ChevronsUpDownIcon aria-hidden="true" className="size-3.5" />
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxContent({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            'bg-popover text-popover-foreground data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 flex max-h-[min(24rem,var(--available-height))] w-[max(var(--anchor-width),16rem)] max-w-(--available-width) origin-(--transform-origin) flex-col border font-mono text-sm duration-100 outline-none md:text-xs',
            className
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

/** The search field, the popup's first row. */
function ComboboxSearch({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-2.5">
      <SearchIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
      <ComboboxPrimitive.Input
        data-slot="combobox-search"
        className={cn(
          'placeholder:text-muted-foreground h-10 w-full min-w-0 bg-transparent text-base outline-none md:h-8 md:text-xs',
          className
        )}
        {...props}
      />
    </div>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        'text-muted-foreground px-3 text-center empty:hidden not-empty:py-4',
        className
      )}
      {...props}
    />
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'min-h-0 scroll-py-1 overflow-y-auto overscroll-contain py-1 empty:p-0',
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-pointer items-center gap-2 py-2 pr-8 pl-3 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 md:py-1.5',
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ComboboxPrimitive.ItemIndicator className="absolute right-2.5 flex">
        <CheckIcon aria-hidden="true" className="size-3.5" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue
}
