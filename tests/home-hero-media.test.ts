import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveHeroMediaAsset } from '../lib/hero-visuals'
import { mergeSiteAppearanceConfig, resolveHeroSlideVisual } from '../lib/site-config'

const read = (path: string) => readFileSync(path, 'utf8')

const baseSlide = {
  title: 'Hero',
  subtitle: '',
  buttonText: '',
  href: '#',
  imageUrl: 'legacy-image',
  mediaType: 'IMAGE',
  mediaUrl: 'legacy-image',
  posterUrl: '',
  sourceUrl: '',
  posterSourceUrl: '',
  isVisible: true,
  sortOrder: 1,
  mobileHeroMedia: null,
}

test('homepage stays empty when desktopHeroMedia is missing or cleared', () => {
  const config = mergeSiteAppearanceConfig({
    heroSlides: [{ ...baseSlide, desktopHeroMedia: null }],
    heroVisuals: {
      home: {
        imageUrl: 'legacy-home',
        desktopHero: 'legacy-home',
        mediaUrl: 'legacy-home',
        mediaType: 'IMAGE',
      },
    },
  })
  const visual = resolveHeroSlideVisual(config.heroVisuals.home, config.heroSlides[0])

  assert.equal(config.heroSlides[0].desktopHeroMedia, null)
  assert.equal(visual?.desktopHeroMedia, null)
  assert.equal(resolveHeroMediaAsset(visual, 'desktop', 'caller-fallback'), null)
})

test('homepage preserves static and animated device media types', () => {
  for (const [mediaType, url] of [['STATIC_IMAGE', 'static.jpg'], ['ANIMATED_IMAGE', 'animated.gif']] as const) {
    const config = mergeSiteAppearanceConfig({
      heroSlides: [{
        ...baseSlide,
        desktopHeroMedia: {
          mediaType,
          imageUrl: url,
          mediaUrl: url,
          posterUrl: '',
          sourceUrl: '',
          posterSourceUrl: '',
        },
      }],
    })
    const visual = resolveHeroSlideVisual(config.heroVisuals.home, config.heroSlides[0])
    const media = resolveHeroMediaAsset(visual, 'desktop')
    assert.equal(media?.mediaType, mediaType)
    assert.equal(media?.mediaUrl, url)
  }
})

test('animated homepage media renders with img and home reads are uncached', () => {
  const background = read('components/HeroBackground.tsx')
  assert.doesNotMatch(background, /from ['"]next\/image['"]/
  )
  assert.match(background, /mediaType === 'ANIMATED_IMAGE'/)
  const upload = read('app/api/uploads/hero-media/route.ts')
  assert.match(upload, /isAnimatedImage\(metadata, input\) \? 'ANIMATED_IMAGE' : 'STATIC_IMAGE'/)
  assert.match(upload, /mediaType: kind === 'poster' \? 'STATIC_IMAGE' : detectedType/)
  assert.match(read('app/community/page.tsx'), /getSiteAppearance\(\{ cache: 'no-store' \}\)/)
  assert.match(read('app/api/admin/home/hero/route.ts'), /Cache-Control.*no-store/)
})
