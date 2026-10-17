import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Outlined, squared buttons (Vltra's paper-and-ink look). Tap-sized on phones, compact from `md`.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border bg-clip-padding font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'border-attention text-attention hover:bg-attention/10',
        outline: 'border-border text-foreground hover:bg-accent',
        destructive:
          'border-destructive text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/30',
        solid: 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
        ghost: 'border-transparent text-foreground hover:bg-accent',
        link: 'border-transparent text-foreground underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-10 gap-1.5 px-3.5 text-sm md:h-7 md:px-2.5 md:text-xs',
        sm: 'h-8 gap-1 px-2.5 text-xs md:h-6 md:px-2',
        lg: 'h-11 gap-1.5 px-4 text-sm md:h-9',
        icon: 'size-10 md:size-7',
        'icon-sm': 'size-8 md:size-6'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
