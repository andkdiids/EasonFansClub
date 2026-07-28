import { adminModulePermissions } from '@/lib/admin-permission-config'
import { getAdminPermissionSet, isSuperAdmin } from '@/lib/admin-permissions'
import type { SessionUser } from '@/lib/auth'
import { formatBeijingDate, getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessages } from '@/lib/checkin-messages'
import { getDailyQuote } from '@/lib/daily'
import {
  getHomeActivities,
  getHomeDailyMessages,
  getHomePosts,
  getHomeTracks,
} from '@/lib/home-data'
import { getHomeAnnouncement } from '@/lib/home-announcement'
import type { PageLayoutPageKey } from '@/lib/page-layout/types'
import { prisma } from '@/lib/prisma'
import { getRegistrationPolicy } from '@/lib/registration'
import { getSiteAppearance, type SiteAppearanceConfig, type SiteHeroSlide } from '@/lib/site-config'

type PreviewModulePayload = { ok: true; data: unknown } | { ok: false; message: string }
export type PageLayoutPreviewPayload = {
  pageKey: PageLayoutPageKey
  generatedAt: string
  modules: Record<string, PreviewModulePayload>
}

type PreviewLoader = (user: SessionUser) => Promise<Record<string, PreviewModulePayload>>

function fallbackHeroSlides(config: SiteAppearanceConfig): SiteHeroSlide[] {
  return [
    {
      title: config.text.homeTitle,
      subtitle: config.text.homeSubtitle,
      buttonText: config.text.homePrimaryButton,
      href: '/checkin',
      imageUrl: config.images.checkinBackgroundUrl,
      isVisible: true,
      sortOrder: 1,
    },
    {
      title: config.text.homeTitle,
      subtitle: config.text.forumCopy,
      buttonText: config.text.homeSecondaryButton,
      href: '/forum',
      imageUrl: config.images.logoUrl,
      isVisible: true,
      sortOrder: 2,
    },
  ]
}

async function moduleData(loader: () => Promise<unknown>): Promise<PreviewModulePayload> {
  try {
    return { ok: true, data: await loader() }
  } catch {
    return { ok: false, message: '模块数据加载失败，预览已降级显示。' }
  }
}

const previewLoaders: Record<PageLayoutPageKey, PreviewLoader> = {
  home: async () => {
    const config = await getSiteAppearance()
    const slides = config.heroSlides.some((item) => item.isVisible) ? config.heroSlides : fallbackHeroSlides(config)
    const [announcement, posts, messages, activities, tracks] = await Promise.all([
      moduleData(() => getHomeAnnouncement()),
      moduleData(() => getHomePosts()),
      moduleData(() => getHomeDailyMessages()),
      moduleData(() => getHomeActivities()),
      moduleData(() => getHomeTracks()),
    ])

    return {
      'home.hero': { ok: true, data: { siteName: config.text.siteName, slides } },
      'home.announcement': announcement,
      'home.checkinEntry': { ok: true, data: { text: config.text } },
      'home.forumEntry': { ok: true, data: { text: config.text } },
      'home.musicEntry': { ok: true, data: { text: config.text } },
      'home.featuredPosts': posts,
      'home.latestPosts': posts,
      'home.dailyMessages': messages,
      'home.music': tracks,
      'home.culture': activities,
      'home.footer': { ok: true, data: { text: config.text.footerText } },
    }
  },
  checkin: async (user) => {
    const today = startOfLocalDay()
    const nextDate = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    const todayValue = formatBeijingDate(today)
    const [stats, userStats, todayCheckIn, messages] = await Promise.all([
      moduleData(async () => ({
        activeUsers: await prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } }),
        todayCount: await prisma.checkIn.count({ where: { checkinDateKey: getShanghaiDateKey(today) } }),
        totalCheckIns: await prisma.checkIn.count({ where: { userId: user.id } }),
      })),
      moduleData(() => prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, level: true, consecutiveDays: true },
      })),
      moduleData(() => prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: getShanghaiDateKey(today) } },
        select: { checkDate: true, mood: true, message: true, streakDay: true, points: true, exp: true, createdAt: true },
      })),
      moduleData(() => getCheckInMessages({
        selectedDate: today,
        nextDate,
        sort: 'latest',
        viewerId: user.id,
      })),
    ])

    return {
      'checkin.header': {
        ok: true,
        data: {
          today: todayValue,
          quote: getDailyQuote(today),
          stats: stats.ok ? stats.data : null,
          userStats: userStats.ok ? userStats.data : null,
          todayCheckIn: todayCheckIn.ok ? todayCheckIn.data : null,
        },
      },
      'checkin.publicMessages': messages,
      'checkin.friendMessages': { ok: true, data: [] },
    }
  },
  forum: async () => ({ 'forum.main': { ok: true, data: {} } }),
  announcement: async () => ({
    'announcement.header': await moduleData(() => prisma.board.findFirst({
      where: { slug: 'announcements', isActive: true },
      select: { name: true, description: true, postCount: true },
    })),
    'announcement.pinned': { ok: true, data: {} },
    'announcement.list': { ok: true, data: {} },
    'announcement.updateLogEntry': { ok: true, data: {} },
    'announcement.sidebar': { ok: true, data: {} },
    'announcement.pagination': { ok: true, data: {} },
  }),
  music: async () => ({
    'music.main': await moduleData(() => prisma.musicTrack.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 5,
      select: { title: true, artist: true },
    })),
  }),
  message: async (user) => ({
    'message.main': await moduleData(() => prisma.notification.count({ where: { recipientId: user.id, isRead: false } })),
  }),
  profile: async (user) => ({
    'profile.main': await moduleData(() => prisma.user.findUnique({
      where: { id: user.id },
      select: { nickname: true, uid: true, level: true, points: true },
    })),
    'profile.calendar': { ok: true, data: {} },
    'profile.recentMessages': { ok: true, data: {} },
    'profile.posts': { ok: true, data: {} },
  }),
  'admin-home': async (user) => {
    const permissionSet = await getAdminPermissionSet(user)
    const visibleModules = Object.entries(adminModulePermissions)
      .filter(([, permission]) => isSuperAdmin(user) || permissionSet.has(permission))
      .map(([href]) => href)
    const [registrationPolicy, stats] = await Promise.all([
      moduleData(() => getRegistrationPolicy()),
      moduleData(async () => ({
        users: await prisma.user.count({ where: { isDeleted: false, status: 'ACTIVE' } }),
        posts: await prisma.post.count({ where: { isDeleted: false } }),
        replies: await prisma.reply.count({ where: { isDeleted: false } }),
        checkIns: await prisma.checkIn.count({ where: { createdAt: { gte: startOfLocalDay() } } }),
        achievements: await prisma.achievement.count().catch(() => 0),
        cultureItems: await prisma.cultureItem.count().catch(() => 0),
      })),
    ])

    return {
      'admin.header': { ok: true, data: { nickname: user.nickname } },
      'admin.registrationStatus': registrationPolicy,
      'admin.stats': stats,
      'admin.modules': { ok: true, data: { visibleModules } },
      'admin.deploymentStatus': { ok: true, data: { processName: 'easonfansclub' } },
    }
  },
}

export async function getPageLayoutPreviewData(pageKey: PageLayoutPageKey, user: SessionUser): Promise<PageLayoutPreviewPayload> {
  return {
    pageKey,
    generatedAt: new Date().toISOString(),
    modules: await previewLoaders[pageKey](user),
  }
}
