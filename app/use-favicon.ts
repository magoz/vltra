'use client'

import { useEffect } from 'react'
import type { VltraCounts } from '@/lib/data/vltra/types'

/** What the favicon's dot says: something needs you, else something is working, else quiet. */
export type FaviconStatus = 'needs-you' | 'working' | 'idle'

const dotColors: Readonly<Record<FaviconStatus, string>> = {
  'needs-you': '#ff4f2b',
  working: '#ffa800',
  idle: '#4cc26a'
}

export const faviconStatus = (counts: VltraCounts): FaviconStatus => {
  if (counts.blocked + counts.finished > 0) return 'needs-you'

  if (counts.working > 0) return 'working'

  return 'idle'
}

/**
 * `app/icon.svg` with the dot in the status' color (idle is the file as is): the wordmark's pixel
 * `v` (3 × 3 cells) nearly filling the icon (a slim margin) on a transparent background, its ink following the browser's
 * light/dark scheme, the dot in the `v`'s empty bottom-right cell.
 */
export const faviconSvg = (status: FaviconStatus): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 17 17">
  <style>path{fill:#3a3835}@media (prefers-color-scheme:dark){path{fill:#ccc8c0}}</style>
  <path d="M0 0h5v10H0zM10 0h5v10h-5zM5 10h5v5H5z"/>
  <circle cx="12.5" cy="12.5" r="2.25" fill="${dotColors[status]}"/>
</svg>
`

/** Points the page's `<link rel="icon">` at the favicon for the vltra's current status. */
export function useFavicon(counts: VltraCounts) {
  const status = faviconStatus(counts)

  useEffect(() => {
    const href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(status))}`

    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
      link.href = href
    }
  }, [status])
}
