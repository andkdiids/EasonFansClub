import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
}

export default nextConfig

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}
