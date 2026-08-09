import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'
import { defaultHeroVisuals, heroFitModes, heroMediaTypes, normalizeHeroScale, type HeroFitMode, type HeroMediaType, type HeroVisualKey, type SiteHeroVisualConfig } from '@/lib/hero-visuals'

export { heroFitModes, heroMediaTypes, heroVisualKeys, pageVisualKeys } from '@/lib/hero-visuals'
export type { HeroFitMode, HeroMediaType, HeroVisualKey, SiteHeroVisualConfig } from '@/lib/hero-visuals'

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
  mediaType?: HeroMediaType
  mediaUrl?: string
  posterUrl?: string
  sourceUrl?: string
  posterSourceUrl?: string
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
      isVisible: true,
      sortOrder: 1,
    },
    {
      title: '在私家E院，和 E友一起待会儿。',
      subtitle: '帖子、留言、音乐，慢慢说。',
      buttonText: '进入广场',
      href: '/forum',
      imageUrl: '',
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

function normalizeHeroSlide(item: SiteHeroSlide): SiteHeroSlide {
  const mediaType = enumValue(item.mediaType, heroMediaTypes, 'IMAGE')
  const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl : ''
  const mediaUrl = typeof item.mediaUrl === 'string' && item.mediaUrl.trim()
    ? item.mediaUrl.trim()
    : mediaType === 'IMAGE' ? imageUrl : ''
  const posterUrl = typeof item.posterUrl === 'string' ? item.posterUrl.trim() : ''
  const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : ''
  const posterSourceUrl = typeof item.posterSourceUrl === 'string' ? item.posterSourceUrl.trim() : ''
  return { ...item, imageUrl, mediaType, mediaUrl, posterUrl, sourceUrl, posterSourceUrl }
}

function normalizeHeroVisual(key: HeroVisualKey, value: unknown, fallbackImageUrl: string, fallbackVisual = defaultSiteAppearance.heroVisuals[key]): SiteHeroVisualConfig {
  const fallback = fallbackVisual
  const partial = value && typeof value === 'object' ? value as Partial<SiteHeroVisualConfig> : {}
  const focusPoint = partial.focusPoint && typeof partial.focusPoint === 'object'
    ? { x: percentage(partial.focusPoint.x), y: percentage(partial.focusPoint.y) }
    : null
  const mediaType = enumValue(partial.mediaType, heroMediaTypes, fallback.mediaType || 'IMAGE')
  const imageUrl = typeof partial.imageUrl === 'string' && partial.imageUrl.trim() ? partial.imageUrl.trim() : fallbackImageUrl
  const desktopHero = typeof partial.desktopHero === 'string' && partial.desktopHero.trim()
    ? partial.desktopHero.trim()
    : imageUrl
  const mobileHero = typeof partial.mobileHero === 'string' && partial.mobileHero.trim()
    ? partial.mobileHero.trim()
    : ''
  const mediaUrl = typeof partial.mediaUrl === 'string' && partial.mediaUrl.trim()
    ? partial.mediaUrl.trim()
    : mediaType === 'IMAGE' ? imageUrl : fallback.mediaUrl || ''
  const sourceUrl = typeof partial.sourceUrl === 'string' && partial.sourceUrl.trim()
    ? partial.sourceUrl.trim()
    : fallback.sourceUrl || ''
  const posterSourceUrl = typeof partial.posterSourceUrl === 'string' && partial.posterSourceUrl.trim()
    ? partial.posterSourceUrl.trim()
    : fallback.posterSourceUrl || ''
  return {
    key,
    title: typeof partial.title === 'string' && partial.title.trim() ? partial.title.trim().slice(0, 80) : fallback.title,
    imageUrl,
    desktopHero,
    mobileHero,
    mediaType,
    mediaUrl,
    posterUrl: typeof partial.posterUrl === 'string' && partial.posterUrl.trim() ? partial.posterUrl.trim() : fallback.posterUrl || '',
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
    .map((item) => item.mediaType === 'IMAGE' ? item.mediaUrl || item.imageUrl : item.posterUrl || item.imageUrl)
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
      home: normalizeHeroVisual('home', visualInput?.home, firstHeroImage),
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

export async function getSiteAppearance() {
  const now = Date.now()
  if (appearanceCache && appearanceCache.expiresAt > now) {
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

  appearanceCache = { expiresAt: now + appearanceCacheTtlMs, config: defaultSiteAppearance, promise }
  const config = await promise
  appearanceCache = { expiresAt: Date.now() + appearanceCacheTtlMs, config }
  return config
}
