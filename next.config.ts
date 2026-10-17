import type { NextConfig } from 'next'
import { getAllowedDevOrigins } from './next-dev-origins'

const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: getAllowedDevOrigins(process.env.PORTLESS_URL),
  experimental: {
    // `proxy.ts` forwards OpenCode's API, and Next buffers every proxied body up to this cap,
    // silently cutting the rest (default 10MB): prompts with pasted images went over it.
    proxyClientMaxBodySize: '1gb'
  },
  // Projects is a tab of the one page now (`app/vltra-href.ts`); the query (`?session=`) passes
  // through.
  redirects: async () => [{ source: '/projects', destination: '/?view=projects', permanent: false }]
} satisfies NextConfig

export default nextConfig
