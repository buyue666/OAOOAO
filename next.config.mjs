import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.cache = false
    // Next's client entry builder prefixes cross-drive Windows paths with ./.
    for (const file of ['next/dist/client/next.js', 'next/dist/client/app-next.js']) {
      const entry = require.resolve(file)
      if (/^[A-Za-z]:/.test(entry)) config.resolve.alias[`./${entry.replaceAll('\\', '/')}`] = entry
    }
    return config
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
