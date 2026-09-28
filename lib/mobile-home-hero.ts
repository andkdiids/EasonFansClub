import type { SiteAppearanceConfig } from '@/lib/site-config'
import { sortHeroSlides } from '@/lib/hero-order'

/** The first visible Web Home slide is the single global image shown in Mobile. */
export function currentMobileHomeHeroImage(config: Pick<SiteAppearanceConfig, 'heroSlides'>): string | null {
  const slide = sortHeroSlides(config.heroSlides).find((item) => item.isVisible)
  if (!slide) return null

  const imageFromAsset = (asset: typeof slide.mobileHeroMedia) => {
    if (!asset) return ''
    if (asset.mediaType === 'VIDEO') return asset.posterUrl || asset.imageUrl || ''
    return asset.mediaUrl || asset.imageUrl || ''
  }
  return imageFromAsset(slide.mobileHeroMedia)
    || imageFromAsset(slide.desktopHeroMedia)
    || (slide.mediaType === 'VIDEO' ? slide.posterUrl : slide.mediaUrl || slide.imageUrl)
    || null
}
