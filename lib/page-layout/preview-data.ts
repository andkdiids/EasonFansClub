import { adminModulePermissions } from '@/lib/admin-permission-config'
import { getAdminPermissionSet, isSuperAdmin } from '@/lib/admin-permissions'
import type { SessionUser } from '@/lib/auth'
import { formatBeijingDate, getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessages } from '@/lib/checkin-messages'
import { getTodayCheckInCount } from '@/lib/checkin-stats'
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
import { formatMusicReleaseDate } from '@/lib/music-display'
import { resolveMusicPlayback } from '@/lib/music-playback'
import { getEnabledConcertCategories } from '@/lib/music-concert-category'
import { publicImageVariantUrl } from '@/lib/image-variants'

type PreviewModulePayload = { ok: true; data: unknown } | { ok: false; message: string }
type PreviewHomeAnnouncement = { id: string; title: string; content: string; link: string | null; buttonUrl: string | null }
export type PageLayoutPreviewPayload = {
  pageKey: PageLayoutPageKey
  generatedAt: string
  modules: Record<string, PreviewModulePayload>
  homeSurface?: {
    siteConfig: SiteAppearanceConfig
    slides: SiteHeroSlide[]
    announcement: PreviewHomeAnnouncement | null
  }
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
      'home.stats': { ok: true, data: { text: config.text } },
      'home.today': messages,
      'home.anywhereDoor': posts,
      'home.salon': activities,
      'home.activityCenter': activities,
      'home.dailyMusic': tracks,
      'home.entertainment': { ok: true, data: {} },
      'home.albums': tracks,
    }
  },
  checkin: async (user) => {
    const today = startOfLocalDay()
    const nextDate = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    const todayValue = formatBeijingDate(today)
    const [stats, userStats, todayCheckIn, messages] = await Promise.all([
      moduleData(async () => ({
        activeUsers: await prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } }),
        todayCount: await getTodayCheckInCount(getShanghaiDateKey(today)),
        totalCheckIns: await prisma.checkIn.count({ where: { userId: user.id } }),
      })),
      moduleData(() => prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, level: true, consecutiveDays: true },
      })),
      moduleData(() => prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: getShanghaiDateKey(today) } },
        select: { checkDate: true, mood: true, moodType: true, moodEmoji: true, moodText: true, message: true, streakDay: true, points: true, exp: true, createdAt: true },
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
    'announcement.main': await moduleData(() => prisma.board.findFirst({
      where: { slug: 'announcements', isActive: true },
      select: { name: true, description: true, postCount: true },
    })),
  }),
  music: async (user) => ({
    'music.main': await moduleData(async () => {
      const [albums, songs, categories] = await Promise.all([
        prisma.musicAlbum.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }],
          take: 12,
          include: { _count: { select: { MusicSong: true } } },
        }),
        prisma.musicSong.findMany({
          where: {
            OR: [{ previewUrl: { not: null } }, { sourceAudioPath: { not: null } }],
            MusicAlbum: { status: 'PUBLISHED' },
          },
          orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }, { createdAt: 'asc' }],
          take: 8,
          select: {
            id: true,
            title: true,
            artist: true,
            releaseYear: true,
            language: true,
            coverUrl: true,
            previewUrl: true,
            previewDuration: true,
            sourceAudioPath: true,
            sourceAudioDurationMs: true,
            MusicAlbum: { select: { id: true, name: true, coverUrl: true } },
          },
        }),
        getEnabledConcertCategories(),
      ])

      return {
        cassetteSongs: songs.flatMap((song) => {
          const playback = resolveMusicPlayback(song, user)
          if (!playback.previewUrl) return []
          return [{
            id: song.id,
            title: song.title,
            artist: song.artist,
            albumId: song.MusicAlbum.id,
            albumTitle: song.MusicAlbum.name,
            releaseYear: song.releaseYear,
            language: song.language,
            coverUrl: publicImageVariantUrl(song.MusicAlbum.coverUrl || song.coverUrl, 'thumb-sm'),
            ...playback,
          }]
        }),
        carouselAlbums: albums.filter((album) => Boolean(album.coverUrl)).map((album) => ({
          id: album.id,
          name: album.name,
          artist: album.artist,
          releaseYear: album.releaseYear,
          language: album.language,
          coverUrl: publicImageVariantUrl(album.coverUrl, 'thumb-md')!,
          songCount: album._count.MusicSong,
          releaseLabel: formatMusicReleaseDate(album.releaseDate, album.releaseYear),
        })),
        archiveAlbums: albums.map((album) => ({
          id: album.id,
          name: album.name,
          artist: album.artist,
          releaseYear: album.releaseYear,
          language: album.language,
          coverUrl: publicImageVariantUrl(album.coverUrl, 'thumb-md'),
          songCount: album._count.MusicSong,
        })),
        categories,
      }
    }),
  }),
  message: async (user) => ({
    'message.main': await moduleData(() => prisma.notification.count({ where: { recipientId: user.id, readAt: null } })),
  }),
  profile: async (user) => ({
    'profile.main': await moduleData(() => prisma.user.findUnique({
      where: { id: user.id },
      select: { nickname: true, uid: true, level: true, points: true },
    })),
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
      'admin.main': { ok: true, data: { nickname: user.nickname, visibleModules, registrationPolicy, stats } },
    }
  },
}

export async function getPageLayoutPreviewData(pageKey: PageLayoutPageKey, user: SessionUser): Promise<PageLayoutPreviewPayload> {
  const modules = await previewLoaders[pageKey](user)
  if (pageKey !== 'home') {
    return { pageKey, generatedAt: new Date().toISOString(), modules }
  }
  const siteConfig = await getSiteAppearance()
  const slides = siteConfig.heroSlides.some((item) => item.isVisible) ? siteConfig.heroSlides : fallbackHeroSlides(siteConfig)
  return {
    pageKey,
    generatedAt: new Date().toISOString(),
    modules,
    homeSurface: {
      siteConfig,
      slides,
      announcement: await getHomeAnnouncement().catch(() => null),
    },
  }
}
