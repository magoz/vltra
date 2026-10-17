import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** The vltra wordmark (pixel letters, 620 × 82), drawn in the current text colour. */
export function Logo({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 620 82"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      role="img"
      aria-label="Vltra"
      className={cn('h-3 w-auto shrink-0', className)}
      {...props}
    >
      <path d="M619.1 20.5V82H557.6V41H578.1V61.5H598.6V41H578.1V20.5H619.1Z" />
      <path d="M479.7 20.5V41H438.7V82H418.2V20.5H479.7Z" />
      <path d="M299.3 0V20.5H319.8V41H299.3V61.5H278.8V0H299.3ZM340.3 61.5V82H299.3V61.5H340.3Z" />
      <path d="M180.399 0V61.5H159.899V20.5H139.399V0H180.399ZM200.899 61.5V82H180.399V61.5H200.899Z" />
      <path d="M20.5 20.5V61.5H0V20.5H20.5ZM61.5 20.5V61.5H41V20.5H61.5ZM41 61.5V82H20.5V61.5H41Z" />
    </svg>
  )
}
