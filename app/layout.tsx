import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fleet',
  description: 'Every OpenCode session on Box',
  applicationName: 'Fleet'
}

export const viewport: Viewport = {
  colorScheme: 'light dark'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="antialiased">
      <body className="font-sans">{children}</body>
    </html>
  )
}
