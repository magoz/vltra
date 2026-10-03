import type { Endpoint } from '@opencode/client/effect/service'
import { Config, Option, Redacted } from 'effect'

/**
 * Explicit endpoint override (tests, local development against a throwaway `opencode serve`).
 * When `OPENCODE_URL` is unset, Fleet discovers the systemd-owned service instead.
 */
export const endpointOverride = Config.all({
  url: Config.option(Config.string('OPENCODE_URL')),
  password: Config.option(Config.redacted('OPENCODE_PASSWORD'))
}).pipe(
  Config.map(({ url, password }) =>
    Option.map(url, (value): Endpoint => {
      if (Option.isNone(password)) return { url: value }

      return {
        url: value,
        auth: { type: 'basic', username: 'opencode', password: Redacted.value(password.value) }
      }
    })
  )
)

/** Registration file for discovery; defaults to `$XDG_STATE_HOME/opencode/service.json`. */
export const serviceFile = Config.option(Config.string('OPENCODE_SERVICE_FILE'))

/**
 * Optional cap on the most recently updated sessions loaded per snapshot (older ones load on
 * demand). Unset: every session.
 */
export const sessionLimit = Config.option(Config.int('FLEET_SESSION_LIMIT'))
