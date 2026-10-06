'use client'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { cn } from '@/lib/utils'

// Fleet's tooltip (Base UI), in the paper-and-ink look: hairline border, no shadow. The header's
// usage line shows each pool's accounts in one.

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = 'bottom',
  align = 'end',
  sideOffset = 6,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'bg-popover text-popover-foreground data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 border font-mono text-xs duration-100 outline-none',
            className
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipTrigger }
