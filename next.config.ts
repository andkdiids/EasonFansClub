import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@prisma/client',
    '.prisma/client',
    '@ffmpeg-installer/ffmpeg',
    '@ffmpeg-installer/win32-x64',
    '@ffmpeg-installer/linux-x64',
    '@ffmpeg-installer/linux-arm64',
    'cos-nodejs-sdk-v5',
  ],
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
