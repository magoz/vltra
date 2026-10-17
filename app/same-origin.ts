import { Effect, Schema } from 'effect'

/** A mutating request did not come from Vltra's own origin. */
export class CrossSiteRequestError extends Schema.TaggedError<CrossSiteRequestError>()(
  'CrossSiteRequestError',
  { message: Schema.String }
) {}

type HeaderReader = { readonly get: (name: string) => string | null }

const firstValue = (value: string | null) => value?.split(',')[0]?.trim() ?? null

/**
 * Same-origin check for mutations (no auth, private tailnet): `Sec-Fetch-Site` must be
 * `same-origin` when the browser sends it, and `Origin` must match the served host.
 */
export const isSameOrigin = (headers: HeaderReader): boolean => {
  const site = headers.get('sec-fetch-site')

  if (site !== null && site !== 'same-origin') return false

  const origin = headers.get('origin')
  const host = firstValue(headers.get('x-forwarded-host')) ?? firstValue(headers.get('host'))

  if (origin === null || host === null || !URL.canParse(origin)) return false

  return new URL(origin).host === host
}

export const requireSameOrigin = (headers: HeaderReader) =>
  isSameOrigin(headers)
    ? Effect.void
    : Effect.fail(new CrossSiteRequestError({ message: 'Cross-site request rejected' }))
