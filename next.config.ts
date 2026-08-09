import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: '110mb',
  },
  serverExternalPackages: [
    '@prisma/client',
    '.prisma/client',
    '@ffmpeg-installer/ffmpeg',
    '@ffmpeg-installer/win32-x64',
    '@ffmpeg-installer/linux-x64',
    '@ffmpeg-installer/linux-arm64',
    'cos-nodejs-sdk-v5',
    'sharp',
  ],
  async headers() {
    return [
      {
        source: '/easmusic/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/images/cassette/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.myqcloud.com',
      },
    ],
  },
}

export default nextConfig

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}
