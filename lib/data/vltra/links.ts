import { Encoding } from 'effect'
import type { SessionLinks } from '@/lib/data/vltra/types'

// Every row of every snapshot needs a link; encode the server key once per base URL.
const prefixes = new WeakMap<URL, string>()

const sessionPrefix = (webUrl: URL): string => {
  const known = prefixes.get(webUrl)

  if (known !== undefined) return known

  const origin = webUrl.origin
  const prefix = `${origin}/server/${Encoding.encodeBase64Url(origin)}/session/`

  prefixes.set(webUrl, prefix)

  return prefix
}

/**
 * OpenCode web UI deep link, verified live against v2.0.20 (`app/src/shell/routes/session.ts`):
 * `<origin>/server/<base64url-no-padding(origin)>/session/<id>`, where the server key is the page
 * origin that serves OpenCode's web UI.
 */
export const openCodeWebSessionUrl = (webUrl: URL, sessionID: string): string =>
  `${sessionPrefix(webUrl)}${encodeURIComponent(sessionID)}`

export const sessionLinks = (webUrl: URL, sessionID: string): SessionLinks => ({
  web: openCodeWebSessionUrl(webUrl, sessionID),
  terminal: `ocb://session/${encodeURIComponent(sessionID)}`,
  command: `ocb -s ${sessionID}`
})
