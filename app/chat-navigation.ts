'use client'

/** OpenCode's session route (v2.0.22 `app/src/shell/routes/session.ts`): `/server/<key>/session/<id>`. */
const sessionPath = /^\/server\/([^/]+)\/session\/[^/]+$/

const parse = (href: string): URL | undefined => (URL.canParse(href) ? new URL(href) : undefined)

/**
 * Whether the chat showing `current` can move to `target` inside OpenCode's own router: both its
 * session route, on the same origin and server.
 */
export const isChatRoute = (current: string, target: string): boolean => {
  const from = parse(current)
  const to = parse(target)

  if (from === undefined || to === undefined || from.origin !== to.origin) return false

  const fromServer = sessionPath.exec(from.pathname)?.[1]

  return fromServer !== undefined && fromServer === sessionPath.exec(to.pathname)?.[1]
}

/**
 * Shows another session in the chat frame. A loaded chat moves inside OpenCode's router (a
 * replaced history entry and the `popstate` its router listens for, as on Back), in tens of
 * milliseconds instead of a whole app start. Otherwise the frame loads the URL, replacing its
 * entry too: Vltra's history stays the user's moves, so Back never steps through the chat.
 */
export function showInChat(frame: HTMLIFrameElement, url: string): 'routed' | 'loading' {
  const frameWindow = frame.contentWindow
  const frameDocument = frame.contentDocument

  if (
    frameWindow !== null &&
    frameDocument !== null &&
    frameDocument.readyState === 'complete' &&
    isChatRoute(frameDocument.URL, url)
  ) {
    const state: unknown = frameWindow.history.state

    frameWindow.history.replaceState(state, '', url)
    frameWindow.dispatchEvent(new PopStateEvent('popstate', { state }))

    return 'routed'
  }

  // Navigating a frame that has not finished loading (or is on its first `about:blank`) replaces
  // its entry anyway; a loaded document needs `location.replace` (cross-origin ones too).
  const settled =
    frameDocument === null ||
    (frameDocument.readyState === 'complete' && frameDocument.URL !== 'about:blank')

  if (frameWindow !== null && settled) frameWindow.location.replace(url)
  else frame.src = url

  return 'loading'
}
