import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-10 w-full min-w-0 rounded-md border bg-transparent px-3 text-base transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 md:h-8 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Input }
