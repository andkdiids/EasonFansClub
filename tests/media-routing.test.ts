import assert from 'node:assert/strict'
import test from 'node:test'
import { isPublicMediaProxyUrl, toPublicMediaUrl, toStoredMediaUrl } from '../lib/media-url'
import { mergeSiteAppearanceConfig, toPublicSiteAppearance } from '../lib/site-config'

const cosUrl = 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/page-visuals/home/hero.webp?version=1'

test('COS browser media is exposed through the existing /cos proxy and storage input is canonicalized', () => {
  assert.equal(toPublicMediaUrl(cosUrl), '/cos/page-visuals/home/hero.webp?version=1')
  assert.equal(toPublicMediaUrl('/cos/page-visuals/home/hero.webp?version=1'), '/cos/page-visuals/home/hero.webp?version=1')
  assert.equal(toStoredMediaUrl('/cos/page-visuals/home/hero.webp?version=1'), cosUrl)
  assert.equal(isPublicMediaProxyUrl('/cos/page-visuals/home/hero.webp?version=1'), true)
})

test('media conversion is conservative and rejects unknown buckets or object keys', () => {
  assert.equal(toPublicMediaUrl('/logo.svg'), '/logo.svg')
  assert.equal(toPublicMediaUrl('/images/logo.webp'), '/images/logo.webp')
  assert.equal(toPublicMediaUrl('https://ecfc.fans/cos/site/logo.webp'), 'https://ecfc.fans/cos/site/logo.webp')
  assert.equal(toPublicMediaUrl('https://example.com/image.webp'), 'https://example.com/image.webp')
  assert.equal(toPublicMediaUrl('site/logo.webp'), 'site/logo.webp')
  assert.equal(toPublicMediaUrl('https://another-bucket.cos.ap-guangzhou.myqcloud.com/site/logo.webp'), 'https://another-bucket.cos.ap-guangzhou.myqcloud.com/site/logo.webp')
  assert.equal(toPublicMediaUrl('data:image/webp;base64,AAAA'), 'data:image/webp;base64,AAAA')
  assert.equal(toPublicMediaUrl('blob:https://ecfc.fans/abc'), 'blob:https://ecfc.fans/abc')
  assert.equal(toPublicMediaUrl(null), null)
  assert.equal(toPublicMediaUrl(undefined), null)
  assert.equal(toPublicMediaUrl(''), null)
  assert.equal(isPublicMediaProxyUrl('/images/logo.webp'), false)
  assert.equal(isPublicMediaProxyUrl('https://ecfc.fans/cos/site/logo.webp'), false)
})

test('site appearance sends public hero and background media through /cos', () => {
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
  assert.equal(publicConfig.images.logoUrl, '/cos/page-visuals/home/hero.webp?version=1')
  assert.equal(publicConfig.heroSlides[0].mediaUrl, '/cos/page-visuals/home/hero.webp?version=1')
})
