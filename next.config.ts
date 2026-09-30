import type { NextConfig } from 'next'
import { getAllowedDevOrigins } from './next-dev-origins'

const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: getAllowedDevOrigins(process.env.PORTLESS_URL)
} satisfies NextConfig

export default nextConfig
