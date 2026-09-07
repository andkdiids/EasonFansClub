import type { SiteHeroSlide } from '@/lib/site-config'

export type HeroMoveDirection = 'up' | 'down'

/** Sort every Hero using the existing persisted sortOrder field. */
export function sortHeroSlides(slides: readonly SiteHeroSlide[]) {
  return slides
    .map((slide, index) => ({ slide, index }))
    .sort((left, right) => left.slide.sortOrder - right.slide.sortOrder || left.index - right.index)
    .map(({ slide }) => slide)
}

/** Move one item by one position and normalize the swapped list atomically. */
export function moveHeroSlide(slides: readonly SiteHeroSlide[], index: number, direction: HeroMoveDirection) {
  const ordered = sortHeroSlides(slides)
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= ordered.length || targetIndex < 0 || targetIndex >= ordered.length) {
    return { slides: [...ordered], moved: false }
  }

  const next = [...ordered]
  const current = next[index]
  next[index] = next[targetIndex]
  next[targetIndex] = current
  return {
    slides: next.map((slide, nextIndex) => ({ ...slide, sortOrder: nextIndex + 1 })),
    moved: true,
  }
}

export function getNextHeroSortOrder(slides: readonly SiteHeroSlide[]) {
  return Math.max(0, ...slides.map((slide) => Number.isFinite(slide.sortOrder) ? slide.sortOrder : 0)) + 1
}
