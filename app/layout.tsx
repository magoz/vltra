import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fleet',
  description: 'Every OpenCode session on Box',
  applicationName: 'Fleet',
  appleWebApp: { capable: true, title: 'Fleet', statusBarStyle: 'default' }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f4' },
    { media: '(prefers-color-scheme: dark)', color: '#1d1d1c' }
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
