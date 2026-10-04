import type { MetadataRoute } from 'next'

/** Installable to the phone home screen (no offline support: Fleet is live data only). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet',
    short_name: 'Fleet',
    description: 'Every OpenCode session on Box',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#faf8f4',
    theme_color: '#faf8f4',
    // Rendered from app/icon.svg with rsvg-convert, like app/apple-icon.png (180 px).
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // The mark sits well inside the maskable safe zone, so the same artwork serves both.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }
}
