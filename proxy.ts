import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { openCodeProxyTarget, proxiedHeaders } from '@/app/opencode-proxy'

const target = openCodeProxyTarget(process.env['OPENCODE_URL'])

/**
 * Serves OpenCode's web UI and API from Fleet's own origin (DESIGN.md "Session panel"), so the
 * chat iframe is same-origin and Fleet can take its keys. Only OpenCode's paths reach here (the
 * matcher); everything else is Fleet's. Next's proxy streams the response (the event stream) and
 * upgrades WebSockets (terminals). `/sw.js` stays out: it is Fleet's own push worker
 * (`public/sw.js`, DESIGN.md "Notifications"); OpenCode's would claim all of Fleet's origin.
 */
export function proxy(request: NextRequest) {
  const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, target)

  return NextResponse.rewrite(destination, {
    request: { headers: proxiedHeaders(request.headers, target) }
  })
}

// OpenCode v2.0.20's root paths (its built `index.html`, chunks and `public/`); keep in sync on
// upgrades. `/api/fleet/*` is Fleet's.
export const config = {
  matcher: [
    '/api/((?!fleet(?:/|$)).*)',
    '/auth/:path*',
    '/server/:path*',
    '/session/:path*',
    '/new-session',
    '/settings/:path*',
    '/btw/:path*',
    '/_server/:path*',
    '/_assets/:path*',
    '/assets/:path*',
    '/icons/:path*',
    '/site.webmanifest',
    '/oc-theme-preload.js',
    '/ghostty-vt.wasm'
  ]
}
