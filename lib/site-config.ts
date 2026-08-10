import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'
import { defaultHeroVisuals, hasHeroMediaAsset, heroFitModes, normalizeHeroMediaType, normalizeHeroScale, type HeroFitMode, type HeroMediaAsset, type HeroMediaType, type HeroVisualKey, type SiteHeroVisualConfig } from '@/lib/hero-visuals'

export { heroFitModes, heroMediaTypes, heroVisualKeys, pageVisualKeys } from '@/lib/hero-visuals'
export type { HeroFitMode, HeroMediaAsset, HeroMediaType, HeroVisualKey, SiteHeroVisualConfig } from '@/lib/hero-visuals'

export type SiteNavItem = {
  label: string
  href: string
  icon: string
  title: string
  isVisible: boolean
  sortOrder: number
}

export type SiteHeroSlide = {
  title: string
  subtitle: string
  buttonText: string
  href: string
  imageUrl: string
  desktopHeroMedia?: HeroMediaAsset | null
  mobileHeroMedia?: HeroMediaAsset | null
  mediaType?: HeroMediaType
  mediaUrl?: string
  posterUrl?: string
  sourceUrl?: string
  posterSourceUrl?: string
  showTitle?: boolean
  showSubtitle?: boolean
  showButton?: boolean
  desktopPositionX?: number
  desktopPositionY?: number
  mobilePositionX?: number
  mobilePositionY?: number
  desktopScale?: number
  mobileScale?: number
  desktopFitMode?: HeroFitMode
  mobileFitMode?: HeroFitMode
  isVisible: boolean
  sortOrder: number
}

export const heroTitleSizes = ['small', 'medium', 'large', 'extra-large'] as const
export const heroDescriptionSizes = ['small', 'medium', 'large'] as const
export const heroButtonSizes = ['small', 'medium', 'large'] as const
export const heroHeightSizes = ['compact', 'standard', 'spacious'] as const
export const heroRadiusSizes = ['small', 'medium', 'large'] as const
export type SiteHeroStyle = {
  titleSize: typeof heroTitleSizes[number]
  descriptionSize: typeof heroDescriptionSizes[number]
  buttonSize: typeof heroButtonSizes[number]
  height: typeof heroHeightSizes[number]
  radius: typeof heroRadiusSizes[number]
}

export type SiteAppearanceConfig = {
  text: {
    siteName: string
    homeTitle: string
    homeSubtitle: string
    homePrimaryButton: string
    homeSecondaryButton: string
    checkinCopy: string
    forumCopy: string
    musicCopy: string
    footerText: string
    emptyText: string
    loginHint: string
    registerHint: string
  }
  colors: {
    primary: string
    secondary: string
    background: string
    text: string
    button: string
    card: string
    nav: string
    link: string
  }
  images: {
    logoUrl: string
    navLogoUrl: string
    loginBackgroundUrl: string
    registerBackgroundUrl: string
    defaultAvatarUrl: string
    defaultProfileBackgroundUrl: string
    checkinBackgroundUrl: string
    musicCoverUrl: string
    activityCoverUrl: string
  }
  nav: SiteNavItem[]
  heroSlides: SiteHeroSlide[]
  heroStyle: SiteHeroStyle
  heroVisuals: Record<HeroVisualKey, SiteHeroVisualConfig>
}

export const defaultSiteAppearance: SiteAppearanceConfig = {
  text: {
    siteName: '私家E院',
    homeTitle: '在私家E院，和 E友一起待会儿。',
    homeSubtitle: '听见 Eason，也听见自己。',
    homePrimaryButton: '今日挂号',
    homeSecondaryButton: '去广场看看',
    checkinCopy: '留下今天的心情。',
    forumCopy: '把一首歌聊成一段故事。',
    musicCopy: '一首歌，也是一段病历。',
    footerText: 'Eason Chan Fans Club',
    emptyText: '这里还安静，等你留下第一句话。',
    loginHint: '回到私家E院，继续查看帖子、签到和参与应援计划。',
    registerHint: '加入私家E院，拥有你的 5 位 UID。',
  },
  colors: {
    primary: '#0f5f8f',
    secondary: '#76c7ee',
    background: '#eef8ff',
    text: '#102033',
    button: '#0f5f8f',
    card: '#ffffff',
    nav: '#ffffff',
    link: '#0f5f8f',
  },
  images: {
    logoUrl: '',
    navLogoUrl: '',
    loginBackgroundUrl: '',
    registerBackgroundUrl: '',
    defaultAvatarUrl: '',
    defaultProfileBackgroundUrl: '',
    checkinBackgroundUrl: '',
    musicCoverUrl: '',
    activityCoverUrl: '',
  },
  nav: [
    { label: '首页', href: '/community', icon: '⌂', title: '首页', isVisible: true, sortOrder: 1 },
    { label: '每日挂号', href: '/checkin', icon: '+', title: '每日挂号', isVisible: true, sortOrder: 2 },
    { label: 'E院广场', href: '/forum', icon: '□', title: 'E院广场', isVisible: true, sortOrder: 3 },
    { label: 'EasMusic', href: '/music', icon: '♪', title: 'EasMusic', isVisible: true, sortOrder: 4 },
    { label: '活动中心', href: '/activities', icon: '◇', title: '活动中心', isVisible: true, sortOrder: 5 },
    { label: '今日', href: '/today', icon: '▣', title: '历史上的今天', isVisible: true, sortOrder: 6 },
    { label: '成就系统', href: '/achievements', icon: '◎', title: '成就系统', isVisible: true, sortOrder: 7 },
    { label: '文化馆', href: '/culture', icon: '✦', title: 'Eason 文化馆', isVisible: true, sortOrder: 8 },
    { label: '消息中心', href: '/notifications', icon: '•', title: '消息中心', isVisible: true, sortOrder: 9 },
  ],
  heroSlides: [
    {
      title: '听见 Eason，也听见自己。',
      subtitle: '今日挂号，记录此刻。',
      buttonText: '开始挂号',
      href: '/checkin',
      imageUrl: '',
      showTitle: true,
      showSubtitle: true,
      showButton: true,
      isVisible: true,
      sortOrder: 1,
    },
    {
      title: '在私家E院，和 E友一起待会儿。',
      subtitle: '帖子、留言、音乐，慢慢说。',
      buttonText: '进入广场',
      href: '/forum',
      imageUrl: '',
      showTitle: true,
      showSubtitle: true,
      showButton: true,
      isVisible: true,
      sortOrder: 2,
    },
  ],
  heroStyle: {
    titleSize: 'large',
    descriptionSize: 'medium',
    buttonSize: 'medium',
    height: 'standard',
    radius: 'large',
  },
  heroVisuals: defaultHeroVisuals,
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function percentage(value: unknown, fallback = 50) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback
}

function optionalPercentage(value: unknown) {
  return value === undefined || value === null || value === '' ? undefined : percentage(value)
}

function optionalHeroScale(value: unknown) {
  return value === undefined || value === null || value === '' ? undefined : normalizeHeroScale(value)
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeHeroMediaAsset(value: unknown, fallback: HeroMediaAsset | null = null): HeroMediaAsset | null {
  if (value === undefined) return fallback ? { ...fallback } : null
  if (value === null || typeof value !== 'object') return null
  const row = value as Partial<HeroMediaAsset>
  const mediaType = normalizeHeroMediaType(row.mediaType, fallback?.mediaType || 'STATIC_IMAGE')
  const hasUrlFields = ['imageUrl', 'mediaUrl', 'posterUrl', 'sourceUrl', 'posterSourceUrl']
    .some((key) => Object.prototype.hasOwnProperty.call(row, key))
  const urlFallback = hasUrlFields ? null : fallback
  const imageUrl = textValue(row.imageUrl) || (mediaType === 'STATIC_IMAGE' ? textValue(row.mediaUrl) : '') || urlFallback?.imageUrl || ''
  const mediaUrl = textValue(row.mediaUrl) || (mediaType === 'STATIC_IMAGE' ? imageUrl : urlFallback?.mediaUrl || '')
  return {
    mediaType,
    imageUrl,
    mediaUrl,
    posterUrl: textValue(row.posterUrl) || urlFallback?.posterUrl || '',
    sourceUrl: textValue(row.sourceUrl) || urlFallback?.sourceUrl || '',
    posterSourceUrl: textValue(row.posterSourceUrl) || urlFallback?.posterSourceUrl || '',
  }
}

export function getHeroMediaForDevice(slide: SiteHeroSlide | null | undefined, device: 'desktop' | 'mobile') {
  if (!slide) return null
  const media = device === 'mobile' ? slide.mobileHeroMedia : slide.desktopHeroMedia
  return hasHeroMediaAsset(media) ? media : null
}

function normalizeHeroSlide(item: SiteHeroSlide): SiteHeroSlide {
  const mediaType = normalizeHeroMediaType(item.mediaType)
  const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl : ''
  const mediaUrl = typeof item.mediaUrl === 'string' && item.mediaUrl.trim()
    ? item.mediaUrl.trim()
    : mediaType === 'STATIC_IMAGE' ? imageUrl : ''
  const posterUrl = typeof item.posterUrl === 'string' ? item.posterUrl.trim() : ''
  const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : ''
  const posterSourceUrl = typeof item.posterSourceUrl === 'string' ? item.posterSourceUrl.trim() : ''
  const normalized: SiteHeroSlide = {
    ...item,
    imageUrl,
    mediaType,
    mediaUrl,
    posterUrl,
    sourceUrl,
    posterSourceUrl,
    showTitle: item.showTitle !== false,
    showSubtitle: item.showSubtitle !== false,
    showButton: item.showButton !== false,
  }
  // A missing or explicitly cleared device asset is an empty state. Never
  // synthesize desktopHeroMedia from the legacy slide image fields.
  normalized.desktopHeroMedia = normalizeHeroMediaAsset(item.desktopHeroMedia, null)
  normalized.mobileHeroMedia = normalizeHeroMediaAsset(item.mobileHeroMedia, null)
  const desktopPositionX = optionalPercentage(item.desktopPositionX)
  const desktopPositionY = optionalPercentage(item.desktopPositionY)
  const mobilePositionX = optionalPercentage(item.mobilePositionX)
  const mobilePositionY = optionalPercentage(item.mobilePositionY)
  const desktopScale = optionalHeroScale(item.desktopScale)
  const mobileScale = optionalHeroScale(item.mobileScale)
  if (desktopPositionX !== undefined) normalized.desktopPositionX = desktopPositionX
  if (desktopPositionY !== undefined) normalized.desktopPositionY = desktopPositionY
  if (mobilePositionX !== undefined) normalized.mobilePositionX = mobilePositionX
  if (mobilePositionY !== undefined) normalized.mobilePositionY = mobilePositionY
  if (desktopScale !== undefined) normalized.desktopScale = desktopScale
  if (mobileScale !== undefined) normalized.mobileScale = mobileScale
  if (item.desktopFitMode !== undefined) normalized.desktopFitMode = enumValue(item.desktopFitMode, heroFitModes, 'COVER')
  if (item.mobileFitMode !== undefined) normalized.mobileFitMode = enumValue(item.mobileFitMode, heroFitModes, 'COVER')
  return normalized
}

/** Resolves explicit per-slide media and composition settings for a Hero. */
export function resolveHeroSlideVisual(
  visual: SiteHeroVisualConfig | null | undefined,
  slide: SiteHeroSlide | null | undefined,
): SiteHeroVisualConfig | null | undefined {
  if (!visual || !slide) return visual

  const isHomeHero = visual.key === 'home'
  const pageDesktopMedia = hasHeroMediaAsset(visual.desktopHeroMedia) ? visual.desktopHeroMedia : null
  const pageMobileMedia = hasHeroMediaAsset(visual.mobileHeroMedia) ? visual.mobileHeroMedia : null
  const slideDesktopMedia = hasHeroMediaAsset(slide.desktopHeroMedia) ? slide.desktopHeroMedia : null
  const slideMobileMedia = hasHeroMediaAsset(slide.mobileHeroMedia) ? slide.mobileHeroMedia : null
  const desktopHeroMedia = isHomeHero ? slideDesktopMedia : pageDesktopMedia || slideDesktopMedia
  const mobileHeroMedia = isHomeHero ? slideMobileMedia : pageMobileMedia || slideMobileMedia
  const mediaType = desktopHeroMedia?.mediaType || normalizeHeroMediaType(visual.mediaType)
  const mediaUrl = desktopHeroMedia?.mediaUrl || (mediaType === 'STATIC_IMAGE' ? desktopHeroMedia?.imageUrl || '' : '')
  const slideImage = desktopHeroMedia?.imageUrl || ''
  const hasSlideMedia = hasHeroMediaAsset(desktopHeroMedia)

  return {
    ...visual,
    title: slide.title || visual.title,
    imageUrl: isHomeHero ? '' : hasSlideMedia ? slideImage : visual.imageUrl,
    desktopHeroMedia,
    mobileHeroMedia,
    desktopHero: isHomeHero ? '' : desktopHeroMedia?.mediaType === 'STATIC_IMAGE' ? desktopHeroMedia.mediaUrl || desktopHeroMedia.imageUrl : visual.desktopHero,
    mobileHero: isHomeHero ? '' : mobileHeroMedia?.mediaType === 'STATIC_IMAGE' ? mobileHeroMedia.mediaUrl || mobileHeroMedia.imageUrl : visual.mobileHero,
    mediaType: isHomeHero ? mediaType : hasSlideMedia ? mediaType : normalizeHeroMediaType(visual.mediaType),
    mediaUrl: isHomeHero ? mediaUrl : hasSlideMedia ? mediaUrl : visual.mediaUrl || '',
    posterUrl: isHomeHero ? desktopHeroMedia?.posterUrl || '' : hasSlideMedia ? desktopHeroMedia?.posterUrl || visual.posterUrl || '' : visual.posterUrl || '',
    sourceUrl: isHomeHero ? desktopHeroMedia?.sourceUrl || '' : hasSlideMedia ? desktopHeroMedia?.sourceUrl || visual.sourceUrl || '' : visual.sourceUrl || '',
    posterSourceUrl: isHomeHero ? desktopHeroMedia?.posterSourceUrl || '' : hasSlideMedia ? desktopHeroMedia?.posterSourceUrl || visual.posterSourceUrl || '' : visual.posterSourceUrl || '',
    desktopPositionX: slide.desktopPositionX ?? visual.desktopPositionX,
    desktopPositionY: slide.desktopPositionY ?? visual.desktopPositionY,
    mobilePositionX: slide.mobilePositionX ?? visual.mobilePositionX,
    mobilePositionY: slide.mobilePositionY ?? visual.mobilePositionY,
    desktopScale: slide.desktopScale ?? visual.desktopScale,
    mobileScale: slide.mobileScale ?? visual.mobileScale,
    desktopFitMode: slide.desktopFitMode ?? visual.desktopFitMode,
    mobileFitMode: slide.mobileFitMode ?? visual.mobileFitMode,
  }
}

function normalizeHeroVisual(key: HeroVisualKey, value: unknown, fallbackImageUrl: string, fallbackVisual = defaultSiteAppearance.heroVisuals[key]): SiteHeroVisualConfig {
  const fallback = fallbackVisual
  const partial = value && typeof value === 'object' ? value as Partial<SiteHeroVisualConfig> : {}
  const isHomeHero = key === 'home'
  const focusPoint = partial.focusPoint && typeof partial.focusPoint === 'object'
    ? { x: percentage(partial.focusPoint.x), y: percentage(partial.focusPoint.y) }
    : null
  const mediaType = normalizeHeroMediaType(partial.mediaType, fallback.mediaType || 'STATIC_IMAGE')
  const imageUrl = isHomeHero ? '' : typeof partial.imageUrl === 'string' && partial.imageUrl.trim() ? partial.imageUrl.trim() : fallbackImageUrl
  const desktopHero = isHomeHero ? '' : typeof partial.desktopHero === 'string' && partial.desktopHero.trim()
    ? partial.desktopHero.trim()
    : imageUrl
  const mobileHero = isHomeHero ? '' : typeof partial.mobileHero === 'string' && partial.mobileHero.trim()
    ? partial.mobileHero.trim()
    : ''
  const mediaUrl = isHomeHero ? '' : typeof partial.mediaUrl === 'string' && partial.mediaUrl.trim()
    ? partial.mediaUrl.trim()
    : mediaType === 'STATIC_IMAGE' ? imageUrl : fallback.mediaUrl || ''
  const desktopHeroMedia = normalizeHeroMediaAsset(partial.desktopHeroMedia, null)
  const mobileHeroMedia = normalizeHeroMediaAsset(partial.mobileHeroMedia, null)
  const sourceUrl = isHomeHero ? '' : typeof partial.sourceUrl === 'string' && partial.sourceUrl.trim()
    ? partial.sourceUrl.trim()
    : fallback.sourceUrl || ''
  const posterSourceUrl = isHomeHero ? '' : typeof partial.posterSourceUrl === 'string' && partial.posterSourceUrl.trim()
    ? partial.posterSourceUrl.trim()
    : fallback.posterSourceUrl || ''
  return {
    key,
    title: typeof partial.title === 'string' && partial.title.trim() ? partial.title.trim().slice(0, 80) : fallback.title,
    imageUrl,
    desktopHero,
    mobileHero,
    desktopHeroMedia,
    mobileHeroMedia,
    mediaType,
    mediaUrl,
    posterUrl: isHomeHero ? '' : typeof partial.posterUrl === 'string' && partial.posterUrl.trim() ? partial.posterUrl.trim() : fallback.posterUrl || '',
    sourceUrl,
    posterSourceUrl,
    desktopPositionX: percentage(partial.desktopPositionX, fallback.desktopPositionX),
    desktopPositionY: percentage(partial.desktopPositionY, fallback.desktopPositionY),
    mobilePositionX: percentage(partial.mobilePositionX, fallback.mobilePositionX),
    mobilePositionY: percentage(partial.mobilePositionY, fallback.mobilePositionY),
    desktopScale: normalizeHeroScale(partial.desktopScale, fallback.desktopScale ?? 100),
    mobileScale: normalizeHeroScale(partial.mobileScale, fallback.mobileScale ?? 100),
    desktopFitMode: enumValue(partial.desktopFitMode, heroFitModes, fallback.desktopFitMode || 'COVER') as HeroFitMode,
    mobileFitMode: enumValue(partial.mobileFitMode, heroFitModes, fallback.mobileFitMode || 'COVER') as HeroFitMode,
    enabled: typeof partial.enabled === 'boolean' ? partial.enabled : fallback.enabled,
    focusPoint,
    updatedAt: typeof partial.updatedAt === 'string' ? partial.updatedAt : '',
  }
}

export function mergeSiteAppearanceConfig(value: unknown): SiteAppearanceConfig {
  if (!value || typeof value !== 'object') return defaultSiteAppearance
  const partial = value as Partial<SiteAppearanceConfig>
  const images = { ...defaultSiteAppearance.images, ...(partial.images || {}) }
  const heroSlides = (partial.heroSlides?.length ? partial.heroSlides : defaultSiteAppearance.heroSlides).map((item) => {
    const normalized = normalizeHeroSlide(item)
    return normalized.href === '/boards/announcements' || normalized.href === '/boards/daily-chat' ? { ...normalized, href: '/forum' } : normalized
  })
  const firstHeroImage = heroSlides
    .filter((item) => item.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    // Keep the existing welcome-page snapshot behavior. This value is only
    // used by the welcome visual; the homepage resolver never consumes it.
    .map((item) => item.mediaType === 'STATIC_IMAGE' ? item.mediaUrl || item.imageUrl : item.posterUrl || item.imageUrl)
    .find(Boolean)
    || images.checkinBackgroundUrl
    || images.loginBackgroundUrl
  const visualInput = partial.heroVisuals as Partial<Record<HeroVisualKey, Partial<SiteHeroVisualConfig>>> | undefined
  const loginVisual = normalizeHeroVisual('login', visualInput?.login, images.loginBackgroundUrl)
  const registerVisualFallback = images.registerBackgroundUrl
    ? defaultSiteAppearance.heroVisuals.register
    : { ...loginVisual, key: 'register' as const, title: defaultSiteAppearance.heroVisuals.register.title }
  const welcomeVisualFallback = visualInput?.welcome
    ? defaultSiteAppearance.heroVisuals.welcome
    : {
        ...defaultSiteAppearance.heroVisuals.welcome,
        imageUrl: firstHeroImage,
        mediaUrl: firstHeroImage,
        desktopPositionX: 68,
        desktopPositionY: 33,
        mobilePositionX: 65,
        mobilePositionY: 50,
      }
  return {
    text: { ...defaultSiteAppearance.text, ...(partial.text || {}) },
    colors: { ...defaultSiteAppearance.colors, ...(partial.colors || {}) },
    images,
    nav: (partial.nav?.length ? partial.nav : defaultSiteAppearance.nav).map((item) => {
      if (item.href === '/') return { ...item, href: '/community' }
      if (item.href === '/boards/announcements' || item.href === '/boards/daily-chat') return { ...item, href: '/forum' }
      return item
    }),
    heroSlides,
    heroStyle: {
      titleSize: enumValue(partial.heroStyle?.titleSize, heroTitleSizes, defaultSiteAppearance.heroStyle.titleSize),
      descriptionSize: enumValue(partial.heroStyle?.descriptionSize, heroDescriptionSizes, defaultSiteAppearance.heroStyle.descriptionSize),
      buttonSize: enumValue(partial.heroStyle?.buttonSize, heroButtonSizes, defaultSiteAppearance.heroStyle.buttonSize),
      height: enumValue(partial.heroStyle?.height, heroHeightSizes, defaultSiteAppearance.heroStyle.height),
      radius: enumValue(partial.heroStyle?.radius, heroRadiusSizes, defaultSiteAppearance.heroStyle.radius),
    },
    heroVisuals: {
      login: loginVisual,
      register: normalizeHeroVisual('register', visualInput?.register, images.registerBackgroundUrl || loginVisual.imageUrl, registerVisualFallback),
      welcome: normalizeHeroVisual('welcome', visualInput?.welcome, firstHeroImage, welcomeVisualFallback),
      home: normalizeHeroVisual('home', visualInput?.home, ''),
      activities: normalizeHeroVisual('activities', visualInput?.activities, images.activityCoverUrl),
      birthday: normalizeHeroVisual('birthday', visualInput?.birthday, images.activityCoverUrl),
      music: normalizeHeroVisual('music', visualInput?.music, ''),
    },
  }
}

const appearanceCacheTtlMs = Number(process.env.SITE_APPEARANCE_CACHE_TTL_MS || 30000)
let appearanceCache: { expiresAt: number; config: SiteAppearanceConfig; promise?: Promise<SiteAppearanceConfig> } | null = null

export function clearSiteAppearanceCache() {
  appearanceCache = null
}

export async function getSiteAppearance(options: { cache?: 'default' | 'no-store' } = {}) {
  const bypassCache = options.cache === 'no-store'
  const now = Date.now()
  if (!bypassCache && appearanceCache && appearanceCache.expiresAt > now) {
    if (appearanceCache.promise) return appearanceCache.promise
    return appearanceCache.config
  }

  const promise = safeDb(
    'site.appearance',
    prisma.siteSetting.findUnique({
      where: { key: 'site.appearance' },
      select: { value: true },
    }),
    null,
  ).then((setting) => {
    if (!setting?.value) return defaultSiteAppearance
    try {
      return mergeSiteAppearanceConfig(JSON.parse(setting.value))
    } catch {
      return defaultSiteAppearance
    }
  })

  if (bypassCache) return promise

  appearanceCache = { expiresAt: now + appearanceCacheTtlMs, config: defaultSiteAppearance, promise }
  const config = await promise
  appearanceCache = { expiresAt: Date.now() + appearanceCacheTtlMs, config }
  return config
}
