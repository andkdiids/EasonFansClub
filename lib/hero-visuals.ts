export const heroVisualKeys = ['login', 'register', 'welcome', 'home', 'activities', 'birthday', 'music'] as const
export const pageVisualKeys = ['login', 'register', 'welcome', 'home', 'activities'] as const
export type HeroVisualKey = typeof heroVisualKeys[number]
export type PageVisualKey = typeof pageVisualKeys[number]

export const heroMediaTypes = ['STATIC_IMAGE', 'ANIMATED_IMAGE', 'VIDEO'] as const
/** Legacy `IMAGE` is accepted only at input boundaries and normalized away. */
export type HeroMediaType = typeof heroMediaTypes[number] | 'IMAGE'

/**
 * `IMAGE` was the old serialized name for a static Hero image. Keep accepting
 * it when reading existing site.appearance JSON, but never expose it as the
 * normalized media type used by the UI or public Hero renderer.
 */
export function normalizeHeroMediaType(value: unknown, fallback: HeroMediaType = 'STATIC_IMAGE'): HeroMediaType {
  if (value === 'IMAGE') return 'STATIC_IMAGE'
  const normalizedFallback = fallback === 'IMAGE' ? 'STATIC_IMAGE' : fallback
  return typeof value === 'string' && heroMediaTypes.includes(value as typeof heroMediaTypes[number])
    ? value as HeroMediaType
    : normalizedFallback
}

export type HeroMediaAsset = {
  mediaType: HeroMediaType
  imageUrl: string
  mediaUrl: string
  posterUrl: string
  sourceUrl: string
  posterSourceUrl: string
}
export const heroFitModes = ['COVER', 'CONTAIN', 'CUSTOM'] as const
export type HeroFitMode = typeof heroFitModes[number]

export const HERO_SCALE_MIN = 40
export const HERO_SCALE_MAX = 200
export const HERO_SCALE_DEFAULT = 100

export function normalizeHeroScale(value: unknown, fallback = HERO_SCALE_DEFAULT) {
  const numeric = Number(value)
  return Number.isFinite(numeric)
    ? Math.max(HERO_SCALE_MIN, Math.min(HERO_SCALE_MAX, Math.round(numeric)))
    : fallback
}

export type HeroPositionMode = 'responsive' | 'desktop' | 'mobile'

export function resolveHeroMediaSettings(
  visual: Pick<SiteHeroVisualConfig, 'desktopPositionX' | 'desktopPositionY' | 'mobilePositionX' | 'mobilePositionY' | 'desktopScale' | 'mobileScale'> & Partial<Pick<SiteHeroVisualConfig, 'desktopFitMode' | 'mobileFitMode'>>,
  device: 'desktop' | 'mobile',
) {
  return device === 'mobile'
    ? {
        positionX: visual.mobilePositionX,
        positionY: visual.mobilePositionY,
        scale: normalizeHeroScale(visual.mobileScale),
        fitMode: visual.mobileFitMode || 'COVER' as HeroFitMode,
      }
    : {
        positionX: visual.desktopPositionX,
        positionY: visual.desktopPositionY,
        scale: normalizeHeroScale(visual.desktopScale),
        fitMode: visual.desktopFitMode || 'COVER' as HeroFitMode,
      }
}

export type HeroMediaDimensions = { width: number; height: number }
export type HeroMediaLayout = HeroMediaDimensions & { left: number; top: number }

export function resolveHeroMediaLayout(
  frame: HeroMediaDimensions,
  media: HeroMediaDimensions,
  settings: { positionX: number; positionY: number; scale: number; fitMode?: HeroFitMode },
): HeroMediaLayout | null {
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) return null
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0) return null

  const baseScale = settings.fitMode === 'CONTAIN'
    ? Math.min(frame.width / media.width, frame.height / media.height)
    : Math.max(frame.width / media.width, frame.height / media.height)
  const multiplier = normalizeHeroScale(settings.scale) / 100
  const width = media.width * baseScale * multiplier
  const height = media.height * baseScale * multiplier
  const positionX = Math.max(0, Math.min(100, Number(settings.positionX) || 0)) / 100
  const positionY = Math.max(0, Math.min(100, Number(settings.positionY) || 0)) / 100

  return {
    width,
    height,
    left: (frame.width - width) * positionX,
    top: (frame.height - height) * positionY,
  }
}

export type SiteHeroVisualConfig = {
  key: HeroVisualKey
  title: string
  imageUrl: string
  desktopHero: string
  mobileHero: string
  desktopHeroMedia?: HeroMediaAsset | null
  mobileHeroMedia?: HeroMediaAsset | null
  mediaType?: HeroMediaType
  mediaUrl?: string
  posterUrl?: string
  sourceUrl?: string
  posterSourceUrl?: string
  desktopPositionX: number
  desktopPositionY: number
  mobilePositionX: number
  mobilePositionY: number
  desktopScale: number
  mobileScale: number
  desktopFitMode: HeroFitMode
  mobileFitMode: HeroFitMode
  enabled: boolean
  focusPoint: { x: number; y: number } | null
  updatedAt: string
}

const visualDefaults = (key: HeroVisualKey, title: string): SiteHeroVisualConfig => ({
  key,
  title,
  imageUrl: '',
  desktopHero: '',
  mobileHero: '',
  mediaType: 'STATIC_IMAGE',
  mediaUrl: '',
  posterUrl: '',
  sourceUrl: '',
  posterSourceUrl: '',
  desktopPositionX: 50,
  desktopPositionY: 50,
  mobilePositionX: 50,
  mobilePositionY: 50,
  desktopScale: HERO_SCALE_DEFAULT,
  mobileScale: HERO_SCALE_DEFAULT,
  desktopFitMode: 'COVER',
  mobileFitMode: 'COVER',
  enabled: true,
  focusPoint: null,
  updatedAt: '',
})

export const defaultHeroVisuals: Record<HeroVisualKey, SiteHeroVisualConfig> = {
  login: visualDefaults('login', '登录页 Hero'),
  register: visualDefaults('register', '注册页 Hero'),
  welcome: visualDefaults('welcome', '欢迎页 Hero'),
  home: visualDefaults('home', '首页 Hero'),
  activities: visualDefaults('activities', '活动中心 Banner'),
  birthday: visualDefaults('birthday', '生日应援 Banner'),
  music: visualDefaults('music', 'EasMusic 背景'),
}

export function resolveHeroImageUrl(
  visual: Pick<SiteHeroVisualConfig, 'desktopHero' | 'mobileHero' | 'imageUrl'> | null | undefined,
  device: 'desktop' | 'mobile',
  fallbackImageUrl = '',
) {
  const desktopHero = typeof visual?.desktopHero === 'string' ? visual.desktopHero.trim() : ''
  const mobileHero = typeof visual?.mobileHero === 'string' ? visual.mobileHero.trim() : ''
  const legacyImage = typeof visual?.imageUrl === 'string' ? visual.imageUrl.trim() : ''

  return device === 'mobile'
    ? mobileHero || desktopHero || legacyImage || fallbackImageUrl
    : desktopHero || legacyImage || fallbackImageUrl
}

export function hasHeroMediaAsset(asset: HeroMediaAsset | null | undefined): asset is HeroMediaAsset {
  return Boolean(asset?.mediaUrl || asset?.imageUrl)
}

export function resolveHeroMediaAsset(
  visual: SiteHeroVisualConfig | null | undefined,
  device: 'desktop' | 'mobile',
  fallbackImageUrl = '',
): HeroMediaAsset | null {
  const desktopMedia = hasHeroMediaAsset(visual?.desktopHeroMedia) ? visual?.desktopHeroMedia : null
  const mobileMedia = hasHeroMediaAsset(visual?.mobileHeroMedia) ? visual?.mobileHeroMedia : null
  const normalizedDesktopMedia = desktopMedia ? { ...desktopMedia, mediaType: normalizeHeroMediaType(desktopMedia.mediaType) } : null
  const normalizedMobileMedia = mobileMedia ? { ...mobileMedia, mediaType: normalizeHeroMediaType(mobileMedia.mediaType) } : null

  // Homepage Hero media is explicit per device. In particular, an empty
  // desktopHeroMedia must stay empty and must not resurrect imageUrl,
  // desktopHero, or a caller-provided fallback image.
  if (visual?.key === 'home') {
    return device === 'mobile' ? normalizedMobileMedia : normalizedDesktopMedia
  }

  const selected = device === 'mobile' ? normalizedMobileMedia || normalizedDesktopMedia : normalizedDesktopMedia
  if (selected) return selected

  const mediaType = normalizeHeroMediaType(visual?.mediaType)
  const responsiveImageUrl = resolveHeroImageUrl(visual, device, fallbackImageUrl)
  const dedicatedImage = device === 'mobile' ? visual?.mobileHero || visual?.desktopHero : visual?.desktopHero
  const mediaUrl = mediaType === 'STATIC_IMAGE'
    ? dedicatedImage && dedicatedImage !== visual?.imageUrl ? responsiveImageUrl : visual?.mediaUrl || responsiveImageUrl
    : visual?.mediaUrl || ''
  const imageUrl = responsiveImageUrl || visual?.imageUrl || ''
  const posterUrl = visual?.posterUrl || (mediaType === 'VIDEO' ? visual?.imageUrl : '') || ''
  if (!mediaUrl && !imageUrl && !posterUrl) return null
  return {
    mediaType,
    imageUrl,
    mediaUrl,
    posterUrl,
    sourceUrl: visual?.sourceUrl || '',
    posterSourceUrl: visual?.posterSourceUrl || '',
  }
}
