import assert from 'node:assert/strict'
import test from 'node:test'
import { publicContentImageMarkers } from '../lib/content-images'
import { buildMusicMediaPublicUrl } from '../lib/music-media-storage'
import { isPublicMediaProxyUrl, toPublicMediaUrl, toStoredMediaUrl } from '../lib/media-url'
import { mergeSiteAppearanceConfig, toPublicSiteAppearance } from '../lib/site-config'

const cosUrl = 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/page-visuals/home/hero.webp?version=1'

test('COS browser media is exposed through the media gateway and storage input is canonicalized', () => {
  const mediaUrl = 'https://media.ecfc.fans/media/page-visuals/home/hero.webp?version=1'
  assert.equal(toPublicMediaUrl(cosUrl), mediaUrl)
  assert.equal(toPublicMediaUrl('/cos/page-visuals/home/hero.webp?version=1'), mediaUrl)
  assert.equal(toStoredMediaUrl('/cos/page-visuals/home/hero.webp?version=1'), cosUrl)
  assert.equal(toStoredMediaUrl(mediaUrl), cosUrl)
  assert.equal(isPublicMediaProxyUrl('/cos/page-visuals/home/hero.webp?version=1'), true)
  assert.equal(isPublicMediaProxyUrl(mediaUrl), true)
})

test('media conversion preserves local/external values and normalizes COS buckets', () => {
  assert.equal(toPublicMediaUrl('/logo.svg'), '/logo.svg')
  assert.equal(toPublicMediaUrl('/images/logo.webp'), '/images/logo.webp')
  assert.equal(toPublicMediaUrl('https://ecfc.fans/cos/site/logo.webp'), 'https://ecfc.fans/cos/site/logo.webp')
  assert.equal(toPublicMediaUrl('https://example.com/image.webp'), 'https://example.com/image.webp')
  assert.equal(toPublicMediaUrl('site/logo.webp'), 'site/logo.webp')
  assert.equal(toPublicMediaUrl('https://another-bucket.cos.ap-guangzhou.myqcloud.com/site/logo.webp'), 'https://media.ecfc.fans/media/site/logo.webp')
  assert.equal(toPublicMediaUrl('data:image/webp;base64,AAAA'), 'data:image/webp;base64,AAAA')
  assert.equal(toPublicMediaUrl('blob:https://ecfc.fans/abc'), 'blob:https://ecfc.fans/abc')
  assert.equal(toPublicMediaUrl(null), null)
  assert.equal(toPublicMediaUrl(undefined), null)
  assert.equal(toPublicMediaUrl(''), null)
  assert.equal(isPublicMediaProxyUrl('/images/logo.webp'), false)
  assert.equal(isPublicMediaProxyUrl('https://ecfc.fans/cos/site/logo.webp'), false)
})

test('legacy post image markers are publicized without changing their marker format', () => {
  assert.equal(
    publicContentImageMarkers(`正文\n[[content-image:${cosUrl}]]`),
    '正文[[content-image:https://media.ecfc.fans/media/page-visuals/home/hero.webp?version=1]]',
  )
})

test('site appearance sends public hero and background media through the media gateway', () => {
  const stored = mergeSiteAppearanceConfig({
    images: { logoUrl: cosUrl },
    heroSlides: [{
      title: 'Hero',
      subtitle: '',
      buttonText: '',
      href: '/',
      imageUrl: cosUrl,
      mediaType: 'STATIC_IMAGE',
      mediaUrl: cosUrl,
      posterUrl: '',
      sourceUrl: '',
      posterSourceUrl: '',
      desktopHeroMedia: null,
      mobileHeroMedia: null,
      isVisible: true,
      sortOrder: 1,
    }],
  })
  const publicConfig = toPublicSiteAppearance(stored)
  assert.equal(publicConfig.images.logoUrl, 'https://media.ecfc.fans/media/page-visuals/home/hero.webp?version=1')
  assert.equal(publicConfig.heroSlides[0].mediaUrl, 'https://media.ecfc.fans/media/page-visuals/home/hero.webp?version=1')
})

test('MEDIA_PUBLIC_BASE_URL overrides the default media gateway', () => {
  const original = process.env.MEDIA_PUBLIC_BASE_URL
  process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test/media/'
  try {
    assert.equal(
      toPublicMediaUrl(cosUrl),
      'https://media.example.test/media/page-visuals/home/hero.webp?version=1',
    )
  } finally {
    if (original === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL
    else process.env.MEDIA_PUBLIC_BASE_URL = original
  }
})

test('music uploads build media gateway URLs for new database values', () => {
  const original = process.env.MEDIA_PUBLIC_BASE_URL
  delete process.env.MEDIA_PUBLIC_BASE_URL
  try {
    assert.equal(
      buildMusicMediaPublicUrl('music-preview/album/song/clip.mp3'),
      'https://media.ecfc.fans/media/music-preview/album/song/clip.mp3',
    )
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test/media/'
    assert.equal(
      buildMusicMediaPublicUrl('music-cover/albums/album/source.webp'),
      'https://media.example.test/media/music-cover/albums/album/source.webp',
    )
  } finally {
    if (original === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL
    else process.env.MEDIA_PUBLIC_BASE_URL = original
  }
})
