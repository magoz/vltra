import { isSameOrigin } from '@/app/same-origin'

/** The systemd-owned OpenCode service's fixed loopback bind (DESIGN.md "Shape"). */
const defaultOpenCodeUrl = 'http://127.0.0.1:49374'

/**
 * Where `proxy.ts` sends OpenCode's web UI and API: `OPENCODE_URL` (dev, a throwaway server), else
 * the service's loopback bind.
 */
export const openCodeProxyTarget = (openCodeUrl: string | undefined): URL =>
  new URL(openCodeUrl ?? defaultOpenCodeUrl)

/**
 * The headers OpenCode gets for a proxied request. Next's proxy sets `Host` to the target, and
 * OpenCode honours its pairing cookie only when `Origin` (if sent) names that host
 * (`authorizedSessionCookie` in `server/src/middleware/authorization.ts`). So a request from
 * Vltra's own origin carries the target's origin instead; any other origin passes through
 * untouched and OpenCode refuses the cookie, as it would without the proxy (no cross-site use of
 * the cookie, e.g. from a sibling subdomain's page).
 */
export const proxiedHeaders = (headers: Headers, target: URL): Headers => {
  const next = new Headers(headers)

  if (next.has('origin') && isSameOrigin(headers)) next.set('origin', target.origin)

  return next
}
