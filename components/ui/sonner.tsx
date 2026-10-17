'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'

const toasterStyle: React.CSSProperties &
  Record<'--normal-bg' | '--normal-text' | '--normal-border' | '--border-radius', string> = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)'
}

// Follows the system appearance, like the rest of Vltra.
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner theme="system" className="toaster group font-mono" style={toasterStyle} {...props} />
)

export { Toaster }
