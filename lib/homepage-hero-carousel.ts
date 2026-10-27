import type { HomepageFeaturedConcert } from '@/lib/homepage-featured-concert'

export type HomepageHeroCarouselSlide<SiteSlide> =
  | Readonly<{ type: 'site'; slide: SiteSlide }>
  | Readonly<{ type: 'concert'; concert: HomepageFeaturedConcert }>

/** Keep the configured site carousel intact and append the optional concert slide. */
export function createHomepageHeroCarouselSlides<SiteSlide>(
  siteSlides: readonly SiteSlide[],
  featuredConcert?: HomepageFeaturedConcert | null,
): HomepageHeroCarouselSlide<SiteSlide>[] {
  return [
    ...siteSlides.map((slide): HomepageHeroCarouselSlide<SiteSlide> => ({ type: 'site', slide })),
    ...(featuredConcert ? [{ type: 'concert', concert: featuredConcert } satisfies HomepageHeroCarouselSlide<SiteSlide>] : []),
  ]
}

export function getAdjacentHomepageHeroIndex(currentIndex: number, slideCount: number, direction: -1 | 1): number {
  if (!Number.isInteger(slideCount) || slideCount <= 0) return 0
  const normalizedIndex = ((Math.trunc(currentIndex) % slideCount) + slideCount) % slideCount
  return (normalizedIndex + direction + slideCount) % slideCount
}

export function getHomepageHeroSwipeDirection(distance: number, threshold = 42): -1 | 1 | null {
  if (!Number.isFinite(distance) || Math.abs(distance) < threshold) return null
  return distance < 0 ? 1 : -1
}
