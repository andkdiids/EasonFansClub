import assert from 'node:assert/strict'
import test from 'node:test'
import { toPublicMediaUrl, toStoredMediaUrl } from '../lib/media-url'
import { mergeSiteAppearanceConfig, toPublicSiteAppearance } from '../lib/site-config'

const cosUrl = 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/page-visuals/home/hero.webp?version=1'

test('COS browser media is exposed through the existing /cos proxy and storage input is canonicalized', () => {
  assert.equal(toPublicMediaUrl(cosUrl), '/cos/page-visuals/home/hero.webp?version=1')
  assert.equal(toPublicMediaUrl('/cos/page-visuals/home/hero.webp?version=1'), '/cos/page-visuals/home/hero.webp?version=1')
  assert.equal(toStoredMediaUrl('/cos/page-visuals/home/hero.webp?version=1'), cosUrl)
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

