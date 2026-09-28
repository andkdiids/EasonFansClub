import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { currentMobileHomeHeroImage } from '../lib/mobile-home-hero'
import type { SiteHeroSlide } from '../lib/site-config'

const slide = (overrides: Partial<SiteHeroSlide> = {}): SiteHeroSlide => ({
  title: '', subtitle: '', buttonText: '', href: '', imageUrl: '',
  isVisible: true, sortOrder: 1, ...overrides,
})

test('mobile uses the first visible Hero under canonical Web slide ordering', () => {
  const config = { heroSlides: [
    slide({ sortOrder: 3, imageUrl: 'https://media.ecfc.fans/third.webp' }),
    slide({ sortOrder: 1, isVisible: false, imageUrl: 'https://media.ecfc.fans/hidden.webp' }),
    slide({ sortOrder: 2,
      desktopHeroMedia: { mediaType: 'STATIC_IMAGE', imageUrl: '', mediaUrl: 'https://media.ecfc.fans/desktop.webp', posterUrl: '', sourceUrl: '', posterSourceUrl: '' },
      mobileHeroMedia: { mediaType: 'STATIC_IMAGE', imageUrl: '', mediaUrl: 'https://media.ecfc.fans/mobile.webp', posterUrl: '', sourceUrl: '', posterSourceUrl: '' },
    }),
  ] }
  assert.equal(currentMobileHomeHeroImage(config), 'https://media.ecfc.fans/mobile.webp')
  assert.equal(currentMobileHomeHeroImage({ heroSlides: [] }), null)
})

test('video rows use an existing still poster and no visible row returns null', () => {
  assert.equal(currentMobileHomeHeroImage({ heroSlides: [slide({ mediaType: 'VIDEO', mediaUrl: 'https://media.ecfc.fans/video.mp4', posterUrl: 'https://media.ecfc.fans/poster.webp' })] }), 'https://media.ecfc.fans/poster.webp')
  assert.equal(currentMobileHomeHeroImage({ heroSlides: [slide({ isVisible: false, imageUrl: 'https://media.ecfc.fans/hidden.webp' })] }), null)
})

test('public GET is anonymous read-only, returns only imageUrl, and does not cache a stale config', () => {
  const route = readFileSync('app/api/mobile/home-hero/route.ts', 'utf8')
  assert.match(route, /export async function GET\(\)/)
  assert.match(route, /getSiteAppearance\(\{ cache: 'no-store' \}\)/)
  assert.match(route, /\{ imageUrl: currentMobileHomeHeroImage\(appearance\) \}/)
  assert.match(route, /Cache-Control': 'public, no-store, max-age=0'/)
  assert.doesNotMatch(route, /requireAdmin|resolveRequestAuth|cookies\(|export async function (POST|PATCH|PUT|DELETE)/)
  assert.equal(Object.keys({ imageUrl: currentMobileHomeHeroImage({ heroSlides: [] }) }).join(','), 'imageUrl')
})
