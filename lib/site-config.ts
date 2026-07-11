import { unstable_noStore as noStore } from 'next/cache'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

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
  isVisible: boolean
  sortOrder: number
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
    { label: '首页', href: '/', icon: '⌂', title: '首页', isVisible: true, sortOrder: 1 },
    { label: '每日挂号', href: '/checkin', icon: '+', title: '每日挂号', isVisible: true, sortOrder: 2 },
    { label: 'E院广场', href: '/boards/announcements', icon: '□', title: 'E院广场', isVisible: true, sortOrder: 3 },
    { label: 'EasMusic', href: '/music', icon: '♪', title: 'EasMusic', isVisible: true, sortOrder: 4 },
    { label: '活动中心', href: '/activities', icon: '◇', title: '活动中心', isVisible: true, sortOrder: 5 },
    { label: '成就系统', href: '/achievements', icon: '◎', title: '成就系统', isVisible: true, sortOrder: 6 },
    { label: '文化馆', href: '/culture', icon: '✦', title: 'Eason 文化馆', isVisible: true, sortOrder: 7 },
    { label: '消息中心', href: '/notifications', icon: '•', title: '消息中心', isVisible: true, sortOrder: 8 },
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
      href: '/boards/announcements',
      imageUrl: '',
      isVisible: true,
      sortOrder: 2,
    },
  ],
}

function mergeConfig(value: unknown): SiteAppearanceConfig {
  if (!value || typeof value !== 'object') return defaultSiteAppearance
  const partial = value as Partial<SiteAppearanceConfig>
  return {
    text: { ...defaultSiteAppearance.text, ...(partial.text || {}) },
    colors: { ...defaultSiteAppearance.colors, ...(partial.colors || {}) },
    images: { ...defaultSiteAppearance.images, ...(partial.images || {}) },
    nav: partial.nav?.length ? partial.nav : defaultSiteAppearance.nav,
    heroSlides: partial.heroSlides?.length ? partial.heroSlides : defaultSiteAppearance.heroSlides,
  }
}

export async function getSiteAppearance() {
  noStore()
  const setting = await safeDb(
    'site.appearance',
    prisma.siteSetting.findUnique({
      where: { key: 'site.appearance' },
      select: { value: true },
    }),
    null,
  )

  if (!setting?.value) return defaultSiteAppearance
  try {
    return mergeConfig(JSON.parse(setting.value))
  } catch {
    return defaultSiteAppearance
  }
}
