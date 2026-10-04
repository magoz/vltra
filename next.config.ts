import type { NextConfig } from 'next'
import { getAllowedDevOrigins } from './next-dev-origins'

const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: getAllowedDevOrigins(process.env.PORTLESS_URL),
  // Projects is a tab of the one page now (`app/fleet-href.ts`); the query (`?session=`) passes
  // through.
  redirects: async () => [{ source: '/projects', destination: '/?view=projects', permanent: false }]
} satisfies NextConfig

export default nextConfig
