export const heroVisualKeys = ['login', 'register', 'welcome', 'home', 'activities', 'birthday', 'music'] as const
export const pageVisualKeys = ['login', 'register', 'welcome', 'home'] as const
export type HeroVisualKey = typeof heroVisualKeys[number]
export type PageVisualKey = typeof pageVisualKeys[number]

export const heroMediaTypes = ['IMAGE', 'ANIMATED_IMAGE', 'VIDEO'] as const
export type HeroMediaType = typeof heroMediaTypes[number]
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
  mediaType: 'IMAGE',
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
