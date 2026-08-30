import type { MetadataRoute } from 'next'

/** One canonical App Router manifest for browser, PWA and Android installs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '私家E院 | Eason Fans Club',
    short_name: '私家E院',
    description: 'Eason Fans Club 私家E院',
    start_url: '/community',
    scope: '/',
    display: 'standalone',
    background_color: '#f5fbfd',
    theme_color: '#0f5f8f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
