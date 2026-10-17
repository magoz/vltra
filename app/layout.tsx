import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ᴠ ʟ ᴛ ʀ ᴀ',
  description: 'Every OpenCode session in one view',
  applicationName: 'Vltra',
  appleWebApp: { capable: true, title: 'Vltra', statusBarStyle: 'default' }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcfcfc' },
    { media: '(prefers-color-scheme: dark)', color: '#131313' }
  ]
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="antialiased">
      <body>{children}</body>
    </html>
  )
}
