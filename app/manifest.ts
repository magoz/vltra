import type { MetadataRoute } from 'next'

/**
 * Installable to the phone home screen (no offline support: Vltra is live data only); iPhone
 * notifications need it (`public/sw.js`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vltra',
    short_name: 'Vltra',
    description: 'Every OpenCode session in one view',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The launch splash (Android) shows the icon on this: the icon's own dark.
    background_color: '#1d1d1c',
    theme_color: '#faf8f4',
    // The wordmark's pixel `v`, light on dark at 29% (as vltra-old's): rendered from
    // app/home-screen-icon.svg with `rsvg-convert -w <size> -h <size>`, like app/apple-icon.png
    // (180 px). The favicon, app/icon.svg, is the same `v` at 42% on transparent.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // The mark sits well inside the maskable safe zone, so the same artwork serves both.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }
}
