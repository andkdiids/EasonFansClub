import type { InstagramPost } from '@/lib/instagram/types'

export const MOCK_INSTAGRAM_POSTS: InstagramPost[] = [
  {
    externalId: 'mock-20260825-carousel',
    shortcode: 'mockCarousel25',
    username: 'mreasonchan',
    caption: 'Mock carousel fixture for the 随意门 Provider contract.',
    publishedAt: new Date('2026-08-25T10:00:00.000Z'),
    permalink: 'https://www.instagram.com/p/mockCarousel25/',
    mediaType: 'CAROUSEL',
    media: [
      { type: 'IMAGE', sourceUrl: 'mock://instagram/image/carousel-1', thumbnailUrl: null, width: 1080, height: 1350, duration: null, sortOrder: 0 },
      { type: 'IMAGE', sourceUrl: 'mock://instagram/image/carousel-2', thumbnailUrl: null, width: 1080, height: 1350, duration: null, sortOrder: 1 },
      { type: 'VIDEO', sourceUrl: 'mock://instagram/video/carousel-3', thumbnailUrl: 'mock://instagram/image/carousel-3-thumb', width: 1080, height: 1350, duration: 12.4, sortOrder: 2 },
    ],
  },
  {
    externalId: 'mock-20260824-reel',
    shortcode: 'mockReel24',
    username: 'mreasonchan',
    caption: 'Mock reel fixture.',
    publishedAt: new Date('2026-08-24T09:30:00.000Z'),
    permalink: 'https://www.instagram.com/reel/mockReel24/',
    mediaType: 'REEL',
    media: [
      { type: 'VIDEO', sourceUrl: 'mock://instagram/video/reel-1', thumbnailUrl: 'mock://instagram/image/reel-1-thumb', width: 1080, height: 1920, duration: 21, sortOrder: 0 },
    ],
  },
  {
    externalId: 'mock-20260823-image',
    shortcode: 'mockImage23',
    username: 'mreasonchan',
    caption: 'Mock image fixture.',
    publishedAt: new Date('2026-08-23T08:00:00.000Z'),
    permalink: 'https://www.instagram.com/p/mockImage23/',
    mediaType: 'IMAGE',
    media: [
      { type: 'IMAGE', sourceUrl: 'mock://instagram/image/single-1', thumbnailUrl: null, width: 1080, height: 1080, duration: null, sortOrder: 0 },
    ],
  },
]
