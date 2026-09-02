'use client'

import type { ReactNode } from 'react'
import { AdminHomeSurface } from '@/components/AdminHomeSurface'
import { createCheckInLayoutModules, type TodayCheckInPayload } from '@/components/CheckInLayoutSurface'
import { ForumHome } from '@/components/ForumHome'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { EasMusicCassetteHero } from '@/components/music/cassette/EasMusicCassetteHero'
import { MusicAlbumArchiveShowcase } from '@/components/music/MusicAlbumArchiveShowcase'
import { MusicSectionNavigation } from '@/components/music/MusicSectionNavigation'
import type { MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { NotificationsClient } from '@/app/notifications/NotificationsClient'
import { ConcertCategoryCards } from '@/components/music/ConcertCategoryCards'
import { ProfilePageSurface, type ProfilePageSurfaceProfile, type ProfilePageSurfaceRelationship } from '@/components/ProfilePageSurface'
import type { CassetteSong } from '@/types/music-cassette'
import type { ConcertCategoryConfig } from '@/lib/music-concert-category'
import { adminNavigationGroups } from '@/lib/admin-navigation'
import { getPageLayoutRegistry } from '@/lib/page-layout/registry'
import type { PageLayoutConfig, PageLayoutPageKey } from '@/lib/page-layout/types'
import type { CheckInMessageItem } from '@/lib/checkin-messages'
import { DEFAULT_USER_PRIVACY_SETTINGS } from '@/lib/user-privacy-types'
import { calculateGrowthSummary, defaultGrowthLevels } from '@/lib/growth'
import type { PageLayoutRendererModules } from '@/components/page-layout/PageLayoutRenderer'

export type LayoutEditorPreviewModulePayload = { ok: true; data: unknown } | { ok: false; message: string }

export type LayoutEditorPreviewData = {
  modules: Record<string, LayoutEditorPreviewModulePayload>
}

type MusicPreviewData = {
  cassetteSongs: CassetteSong[]
  carouselAlbums: MusicCarouselAlbum[]
  archiveAlbums: Array<{ id: string; name: string; artist: string; releaseYear: number; language: string; coverUrl: string | null; songCount: number }>
  categories: ConcertCategoryConfig[]
}

function readObject(data: unknown) {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

function readNumber(data: Record<string, unknown>, key: string, fallback = 0) {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readString(data: Record<string, unknown>, key: string, fallback = '') {
  return typeof data[key] === 'string' ? data[key] : fallback
}

function readStringList(data: Record<string, unknown>, key: string) {
  return Array.isArray(data[key]) ? data[key].filter((value): value is string => typeof value === 'string') : []
}

function routeFromHref(href: string) {
  return href.split(/[?#]/, 1)[0]
}

function filterAdminPreviewGroups(preview: LayoutEditorPreviewData | null) {
  const payload = preview?.modules?.['admin.main']
  if (!payload?.ok) return adminNavigationGroups
  const data = readObject(payload.data)
  const visibleRoutes = new Set(readStringList(data, 'visibleModules').map(routeFromHref))
  if (!visibleRoutes.size) return adminNavigationGroups
  return adminNavigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => {
      const route = routeFromHref(item.href)
      return visibleRoutes.has(route) || [...visibleRoutes].some((parent) => route.startsWith(`${parent}/`))
    }) }))
    .filter((group) => group.items.length > 0)
}

function readTodayCheckIn(data: unknown): TodayCheckInPayload {
  const item = readObject(data)
  if (!readString(item, 'checkDate') || !readString(item, 'createdAt')) return null
  return {
    checkDate: readString(item, 'checkDate'),
    points: readNumber(item, 'points'),
    exp: readNumber(item, 'exp'),
    mood: typeof item.mood === 'string' ? item.mood : null,
    message: typeof item.message === 'string' ? item.message : null,
    streakDay: readNumber(item, 'streakDay'),
    createdAt: readString(item, 'createdAt'),
  }
}

function readCheckInMessages(data: unknown): CheckInMessageItem[] {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is CheckInMessageItem => {
    const value = readObject(item)
    const user = readObject(value.user)
    return typeof value.id === 'string' && typeof value.content === 'string' && typeof value.createdAt === 'string'
      && typeof user.uid === 'string' && typeof user.nickname === 'string'
      && Array.isArray(value.comments) && Array.isArray(value.likes) && Array.isArray(value.favorites)
  })
}

function readMusicPreviewData(data: unknown): MusicPreviewData {
  const value = readObject(data)
  return {
    cassetteSongs: Array.isArray(value.cassetteSongs) ? value.cassetteSongs as CassetteSong[] : [],
    carouselAlbums: Array.isArray(value.carouselAlbums) ? value.carouselAlbums as MusicCarouselAlbum[] : [],
    archiveAlbums: Array.isArray(value.archiveAlbums) ? value.archiveAlbums as MusicPreviewData['archiveAlbums'] : [],
    categories: Array.isArray(value.categories) ? value.categories as ConcertCategoryConfig[] : [],
  }
}

function MusicPagePreview({ data }: Readonly<{ data: unknown }>) {
  const music = readMusicPreviewData(data)
  return (
    <MusicArchiveShell variant="home">
      <div className="space-y-14 sm:space-y-20">
        <EasMusicCassetteHero songs={music.cassetteSongs} />
        <MusicAlbumArchiveShowcase carouselAlbums={music.carouselAlbums} albums={music.archiveAlbums} />
        <MusicSectionNavigation />
        <section aria-labelledby="layout-editor-music-preview-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="layout-editor-music-preview-title" className="text-3xl font-black tracking-tight text-white sm:text-4xl">Eason in Concert</h2>
            <span className="text-sm font-black text-sky-300">进入完整档案 →</span>
          </div>
          {music.categories.length ? <div className="mt-6"><ConcertCategoryCards categories={music.categories} /></div> : null}
          <p className="mt-7 rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-sm font-bold text-slate-300">演唱会档案正在整理中。</p>
        </section>
      </div>
    </MusicArchiveShell>
  )
}

function ProfilePagePreview() {
  const profile: ProfilePageSurfaceProfile = {
    id: 'layout-preview-user',
    uid: 10001,
    displayName: 'E院预览用户',
    baseDisplayName: 'E院预览用户',
    bio: '这里展示真实个人病历页面组件的布局效果。',
    location: null,
    ipRegion: null,
    avatarUrl: null,
    backgroundUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    wallVisibility: 'PUBLIC',
    publicLiveCount: 0,
    equippedBadge: null,
    badgeSummary: null,
    privacy: DEFAULT_USER_PRIVACY_SETTINGS,
    recordPreferences: [],
  }
  const relationship: ProfilePageSurfaceRelationship = {
    isSelf: true,
    isFriend: false,
    isBlocked: false,
    isFollowed: false,
    hasViewer: true,
    friendStatus: 'NONE',
    initialRemark: null,
  }
  return (
    <ProfilePageSurface
      profile={profile}
      growth={calculateGrowthSummary(120, [...defaultGrowthLevels])}
      relationship={relationship}
      recentMessages={[]}
      recentMessagesPagination={{ page: 1, pageSize: 10, total: 0, totalPages: 1, hasMore: false }}
    />
  )
}

function NotificationsPagePreview() {
  return (
    <NotificationsClient
      initialNotifications={[]}
      initialPagination={{ page: 1, pageSize: 20, total: 0, totalPages: 1 }}
      initialCategory="all"
      canReview
      initialLoadWarning={null}
      initialLoadError={null}
    />
  )
}

function singlePageModule(pageKey: PageLayoutPageKey, render: () => ReactNode): PageLayoutRendererModules {
  const definition = getPageLayoutRegistry(pageKey)[0]
  return definition ? { [definition.key]: render } : {}
}

function createCheckInPreviewModules(
  previewConfig: PageLayoutConfig,
  previewData: LayoutEditorPreviewData | null,
  checkInPreviewState: 'pending' | 'completed',
) {
  const headerData = previewData?.modules?.['checkin.header']?.ok ? readObject(previewData.modules['checkin.header'].data) : {}
  const statsData = readObject(headerData.stats)
  const userStatsData = readObject(headerData.userStats)
  const loadedTodayCheckIn = readTodayCheckIn(headerData.todayCheckIn)
  const todayValue = readString(headerData, 'today', new Date().toISOString().slice(0, 10))
  const previewTodayCheckIn: TodayCheckInPayload = checkInPreviewState === 'completed'
    ? loadedTodayCheckIn || { checkDate: todayValue, points: 10, exp: 5, mood: 'happy', message: '今天也要好好生活，明天继续来私家E院报到。', streakDay: Math.max(1, readNumber(userStatsData, 'consecutiveDays')), createdAt: new Date().toISOString() }
    : null
  const messagesData = previewData?.modules?.['checkin.publicMessages']?.ok ? readCheckInMessages(previewData.modules['checkin.publicMessages'].data) : []
  const friendMessagesData = previewData?.modules?.['checkin.friendMessages']?.ok ? readCheckInMessages(previewData.modules['checkin.friendMessages'].data) : []
  return createCheckInLayoutModules({
    layoutConfig: previewConfig,
    dailyQuote: readString(headerData, 'quote'),
    activeUsers: readNumber(statsData, 'activeUsers'),
    todayCount: readNumber(statsData, 'todayCount'),
    consecutiveDays: readNumber(userStatsData, 'consecutiveDays'),
    totalCheckIns: readNumber(statsData, 'totalCheckIns'),
    moodIndex: 0,
    todayCheckIn: previewTodayCheckIn,
    selectedMessages: messagesData,
    friendMessages: friendMessagesData,
    selectedDateValue: todayValue,
    todayValue,
    sort: 'latest',
    sessionUserId: '',
    sessionUserRole: 'USER',
    stats: { level: readNumber(userStatsData, 'level', 1), points: readNumber(userStatsData, 'points'), exp: readNumber(userStatsData, 'exp'), consecutiveDays: readNumber(userStatsData, 'consecutiveDays') },
    previewMode: true,
  })
}

/** Resolve editor preview content from the shared module component identities. */
export function createPageLayoutEditorModules({
  pageKey,
  previewConfig,
  previewData,
  checkInPreviewState,
}: {
  pageKey: PageLayoutPageKey
  previewConfig: PageLayoutConfig
  previewData: LayoutEditorPreviewData | null
  checkInPreviewState: 'pending' | 'completed'
}): PageLayoutRendererModules {
  const componentKey = getPageLayoutRegistry(pageKey)[0]?.componentKey
  switch (componentKey) {
    case 'CHECKIN_HEADER':
      return createCheckInPreviewModules(previewConfig, previewData, checkInPreviewState)
    case 'FORUM_MAIN':
    case 'ANNOUNCEMENT_MAIN':
      return singlePageModule(pageKey, () => <ForumHome previewMode />)
    case 'MUSIC_MAIN': {
      const musicData = previewData?.modules?.['music.main']?.ok ? previewData.modules['music.main'].data : null
      return singlePageModule(pageKey, () => <MusicPagePreview data={musicData} />)
    }
    case 'MESSAGE_MAIN':
      return singlePageModule(pageKey, () => <NotificationsPagePreview />)
    case 'PROFILE_MAIN':
      return singlePageModule(pageKey, () => <ProfilePagePreview />)
    case 'ADMIN_MAIN':
      return singlePageModule(pageKey, () => <AdminHomeSurface groups={filterAdminPreviewGroups(previewData)} />)
    default:
      return {}
  }
}
