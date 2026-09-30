import { Encoding } from 'effect'
import type { SessionLinks } from '@/lib/data/fleet/types'

/**
 * OpenCode web UI deep link, verified live against v2.0.20 (`app/src/shell/routes/session.ts`):
 * `<origin>/server/<base64url-no-padding(origin)>/session/<id>`, where the server key is the page
 * origin that serves OpenCode's web UI.
 */
export const openCodeWebSessionUrl = (webUrl: URL, sessionID: string): string => {
  const origin = webUrl.origin

  return `${origin}/server/${Encoding.encodeBase64Url(origin)}/session/${encodeURIComponent(sessionID)}`
}

export const sessionLinks = (webUrl: URL, sessionID: string): SessionLinks => ({
  web: openCodeWebSessionUrl(webUrl, sessionID),
  terminal: `ocb://session/${encodeURIComponent(sessionID)}`,
  command: `ocb -s ${sessionID}`
})
