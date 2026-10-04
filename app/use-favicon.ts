'use client'

import { useEffect } from 'react'
import type { FleetCounts } from '@/lib/data/fleet/types'

/** What the favicon's dot says: something needs you, else something is working, else quiet. */
export type FaviconStatus = 'needs-you' | 'working' | 'idle'

const dotColors: Readonly<Record<FaviconStatus, string>> = {
  'needs-you': '#f5c542',
  working: '#4cc26a',
  idle: '#ff4f2b'
}

export const faviconStatus = (counts: FleetCounts): FaviconStatus => {
  if (counts.blocked + counts.finished > 0) return 'needs-you'

  if (counts.working > 0) return 'working'

  return 'idle'
}

/** `app/icon.svg` with the dot in the status' color (idle is the file as is). */
export const faviconSvg = (status: FaviconStatus): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#141312"/>
  <path d="M112 400V131A269 269 0 0 1 381 400Z" fill="#eeebe6"/>
  <circle cx="360.55" cy="151.45" r="39.45" fill="${dotColors[status]}"/>
</svg>
`

/** Points the page's `<link rel="icon">` at the favicon for the fleet's current status. */
export function useFavicon(counts: FleetCounts) {
  const status = faviconStatus(counts)

  useEffect(() => {
    const href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(status))}`

    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
      link.href = href
    }
  }, [status])
}
