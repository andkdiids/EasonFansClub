'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { HomeHero } from '@/components/HomeHero'
import { LikeButton } from '@/components/PostActions'
import { SafeAvatar } from '@/components/SafeAvatar'
import { useMusicPlayer, type MusicPreviewTrack } from '@/components/music/MusicPlayerProvider'
import { getPageLayoutModules } from '@/components/page-layout/PageLayoutRenderer'
import { GUESS_SONG_MODE_CONFIG, GUESS_SONG_PUBLIC_MODES, type GuessSongPublicMode } from '@/lib/guess-song-config'
import type { GuessSongModeHighScore, GuessSongModeHighScores } from '@/lib/guess-song-leaderboard'
import type { PageLayoutConfig, PageLayoutDevice } from '@/lib/page-layout/types'
import type { SiteAppearanceConfig, SiteHeroSlide } from '@/lib/site-config'
import { parseCalendarDate } from '@/lib/calendar-date'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'
import { normalizeActionUrl } from '@/lib/url-safety'

const homeText = {
  checkedIn: '已签到',
  notCheckedIn: '未挂号',
  goCheckin: '去挂号',
  loadingStats: '正在读取签到数据',
  totalCheckins: '累计签到',
  days: '天',
  viewCheckin: '查看签到记录',
  members: 'E院人数',
  todayCheckins: '今日挂号',
  birthdays: '今日生日',
  dailyMusic: 'EasMusic 今日推荐',
  viewDetails: '查看资料',
  preview: '试听 60 秒',
  pausePreview: '暂停试听',
  loadingPreview: '加载中...',
  noMusic: '今日暂时没有可试听的推荐歌曲。',
  noLyrics: '这首歌还没有歌词资料。',
  today: '今日',
  todayMore: '与你常在',
  noToday: '今天还没有历史记录，先留下一个占位。',
  entertainment: '娱乐天空',
  rankingMore: '进入游戏中心',
  rankingBest: '历史最高分',
  noRanking: '暂无成绩，快去挑战吧。',
  rankingLoading: '正在读取历史成绩...',
  rankingUnavailable: '成绩暂时无法读取，请稍后刷新。',
  randomAlbums: '每日推荐专辑',
  albumsMore: '更多',
  featured: '精选',
  pinned: '置顶',
  more: '更多',
  noAlbums: '暂无已发布专辑。',
  hotConcerts: '热门演唱会',
  concertsMore: '查看全部',
  noConcerts: '演唱会档案正在整理中。',
  distance: '距今',
  years: '周年',
  loadError: '部分社区内容暂时无法载入，请稍后刷新。',
} as const

const todayTypeLabels: Record<string, string> = {
  ALBUM: '专辑发行',
  SONG: '歌曲发行',
  CAREER: '事业节点',
  CUSTOM: '自定义',
  BIRTHDAY: '生日',
  DEBUT: '出道',
  ROOKIE_CONTEST: '新秀比赛',
  ALBUM_RELEASE: '专辑发行',
  CONCERT: '演唱会',
  AWARD: '获奖',
  OTHER: '其他',
}

type Announcement = { id: string; title: string; content: string; link: string | null; buttonUrl: string | null }
type Post = { id: string; title: string; content: string; likeCount: number; likedByMe: boolean; replyCount: number; viewCount: number; isPinned: boolean; isFeatured: boolean; createdAt: string; board: { name: string }; author: { uid: number; nickname: string; profile?: { displayName: string | null } | null } }
type Album = { id: string; name: string; releaseYear: number; coverUrl: string | null }
type Stats = { consecutiveDays: number; checkIns: { id: string }[]; _count: { checkIns: number } }
type SiteStats = { memberCount: number; todayCheckIns: number; todayBirthdays: number }
type DailyMusic = { id: string; title: string; artist: string; releaseYear: number; lyrics: string | null; coverUrl: string | null; previewUrl: string; previewDuration: number; isFullPlayback: false; album: { id: string; name: string; coverUrl: string | null } }
type TodayEvent = { id: string; date: string; year: number; month: number; day: number; type: string; title: string; content: string; imageUrl: string | null; source: 'AUTO' | 'ADMIN'; reference: string | null; status: 'APPROVED'; href: string | null }
type EntertainmentRanking = Omit<GuessSongModeHighScores, 'status'> & { status: GuessSongModeHighScores['status'] | 'loading' }
type HomeConcert = { id: string; title: string; concertDate: string; city: string; venue: string | null; tourName: string; posterUrl: string | null; href: string }
type Payload = { posts: Post[]; activities: unknown[]; albums: Album[]; stats: Stats | null; dailyMusic: DailyMusic | null; siteStats: SiteStats | null; todayEvents: TodayEvent[]; entertainmentRanking: EntertainmentRanking | null; concerts: HomeConcert[] }

const modeLabels = Object.fromEntries(
  GUESS_SONG_PUBLIC_MODES.map((mode) => [mode, GUESS_SONG_MODE_CONFIG[mode].label]),
) as Record<GuessSongPublicMode, string>

function emptyEntertainmentModes() {
  return Object.fromEntries(GUESS_SONG_PUBLIC_MODES.map((mode) => [mode, null])) as Record<GuessSongPublicMode, GuessSongModeHighScore | null>
}

const loadingEntertainmentRanking: EntertainmentRanking = {
  status: 'loading',
  periodType: 'HISTORY',
  periodKey: 'ALL',
  modes: emptyEntertainmentModes(),
  mobileBest: null,
}

function useDevice(): PageLayoutDevice {
  const [device, setDevice] = useState<PageLayoutDevice>('desktop')
  useEffect(() => {
    const mobile = matchMedia('(max-width:767px)')
    const update = () => setDevice(mobile.matches ? 'mobile' : 'desktop')
    update()
    mobile.addEventListener('change', update)
    return () => {
      mobile.removeEventListener('change', update)
    }
  }, [])
  return device
}

function excerpt(value: string | null | undefined, length = 70) {
  if (!value) return ''
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

// 历史上的今天日期格式化：YYYY年MM月DD日（月/日零填充，对齐用户要求）。
function formatTodayDate(year: number, month: number, day: number) {
  return `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`
}

function yearsFromToday(value: string) {
  const eventDate = parseCalendarDate(value)
  const today = parseCalendarDate(new Date())
  return Math.max(0, today.year - eventDate.year)
}

function EntertainmentScoreUser({ score }: { score: GuessSongModeHighScore }) {
  return (
    <div className="home-entertainment-score-user" title={score.user.name}>
      <span className="home-entertainment-score-avatar"><SafeAvatar src={score.user.avatarUrl} name={score.user.name} uid={score.user.uid} className="home-entertainment-score-avatar-image" textClassName="home-entertainment-score-avatar-fallback" /></span>
      <span className="home-entertainment-score-username">{score.user.name}</span>
    </div>
  )
}

function HomeDailyMusicPreview({ music }: { music: DailyMusic }) {
  const player = useMusicPlayer()
  const isActive = player.track?.id === music.id
  const isPlaying = isActive && player.playing
  const isLoading = isActive && player.loading

  async function toggle() {
    if (!music.previewUrl || player.loading) return
    if (isActive && player.playing) {
      player.pause()
      return
    }
    const track: MusicPreviewTrack = {
      id: music.id,
      songId: music.id,
      title: music.title,
      artist: music.artist,
      albumName: music.album.name,
      coverUrl: music.coverUrl,
      previewUrl: music.previewUrl,
      previewDuration: Math.min(60, music.previewDuration || 60),
      isFullPlayback: false,
    }
    await player.playTrack(track)
  }

  return (
    <button
      type="button"
      className="hero-primary-button home-daily-music-button"
      disabled={!music.previewUrl || isLoading}
      aria-pressed={isPlaying}
      onClick={() => void toggle()}
    >
      {isLoading ? homeText.loadingPreview : isPlaying ? homeText.pausePreview : homeText.preview}
    </button>
  )
}

export function HomeLayoutSurface({ layoutConfig, siteConfig, slides, announcement }: { layoutConfig: PageLayoutConfig; siteConfig: SiteAppearanceConfig; slides: SiteHeroSlide[]; announcement: Announcement | null }) {
  const device = useDevice()
  const items = useMemo(() => getPageLayoutModules(layoutConfig, device, 'home'), [layoutConfig, device])
  const layoutModule = (key: string) => items.find((item) => item.key === key)
  const visible = (key: string) => Boolean(layoutModule(key))
  const [data, setData] = useState<Payload>({ posts: [], activities: [], albums: [], stats: null, dailyMusic: null, siteStats: null, todayEvents: [], entertainmentRanking: loadingEntertainmentRanking, concerts: [] })
  const [failed, setFailed] = useState(false)
  const [todayEventIndex, setTodayEventIndex] = useState(0)
  const [todayPageIndex, setTodayPageIndex] = useState(0)
  const [todayAutoplayReset, setTodayAutoplayReset] = useState(0)
  const [todaySwipeDirection, setTodaySwipeDirection] = useState<'next' | 'previous' | null>(null)
  const todayTouchStart = useRef<{ x: number; y: number } | null>(null)
  const todayTouchCurrent = useRef<{ x: number; y: number } | null>(null)
  const fmt = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
  const topRanking = data.entertainmentRanking?.mobileBest || null
  const entertainmentModes = data.entertainmentRanking?.modes || emptyEntertainmentModes()
  const dailyMusicCoverUrl = publicImageVariantUrl(data.dailyMusic?.album.coverUrl, 'thumb-sm') || null

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    async function load() {
      try {
        const response = await fetch('/api/home', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('home request failed')
        const nextData = await response.json() as Payload
        if (!disposed) {
          // The main home payload intentionally keeps entertainment ranking in
          // its own request. Do not let its legacy null field overwrite the
          // independently loaded result.
          setData((current) => ({ ...nextData, concerts: nextData.concerts || [], entertainmentRanking: current.entertainmentRanking }))
          setFailed(false)
        }
      } catch (error) {
        if (!disposed && !(error instanceof Error && error.name === 'AbortError')) setFailed(true)
      }
    }
    async function loadEntertainmentRanking() {
      try {
        const response = await fetch('/api/home/entertainment-ranking', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          if (!disposed) setData((current) => ({ ...current, entertainmentRanking: { ...loadingEntertainmentRanking, status: 'unavailable' } }))
          return
        }
        const nextData = await response.json() as { entertainmentRanking?: Payload['entertainmentRanking'] }
        if (!disposed) setData((current) => ({ ...current, entertainmentRanking: nextData.entertainmentRanking || { ...loadingEntertainmentRanking, status: 'unavailable' } }))
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          if (!disposed) setData((current) => ({ ...current, entertainmentRanking: { ...loadingEntertainmentRanking, status: 'unavailable' } }))
          if (process.env.NODE_ENV === 'development') console.debug('[home entertainment ranking]', error)
        }
      }
    }
    const refresh = () => {
      if (document.visibilityState !== 'hidden') {
        void load()
        void loadEntertainmentRanking()
      }
    }
    void load()
    void loadEntertainmentRanking()
    window.addEventListener('checkin:completed', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      disposed = true
      controller.abort()
      window.removeEventListener('checkin:completed', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !data.dailyMusic) return
    console.log('album cover url', dailyMusicCoverUrl)
    if (!dailyMusicCoverUrl) console.log('album cover missing')
  }, [data.dailyMusic, dailyMusicCoverUrl])

  const todayPageCount = Math.ceil(data.todayEvents.length / 2)

  useEffect(() => {
    setTodayEventIndex((current) => data.todayEvents.length ? current % data.todayEvents.length : 0)
    setTodayPageIndex((current) => todayPageCount ? current % todayPageCount : 0)
    if (data.todayEvents.length <= 2) return
    const timer = window.setInterval(() => {
      if (device === 'desktop') {
        setTodayPageIndex((current) => (current + 1) % todayPageCount)
      } else {
        setTodayEventIndex((current) => (current + 1) % data.todayEvents.length)
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [data.todayEvents.length, device, todayPageCount, todayAutoplayReset])

  const checkedIn = Boolean(data.stats?.checkIns.length)
  const checkinStateClass = data.stats ? checkedIn ? 'is-checked' : 'is-not-checked' : 'is-loading'
  const todayEvent = data.todayEvents[todayEventIndex] || null
  const desktopTodayEvents = useMemo(() => {
    if (todayPageCount <= 1) return []
    return data.todayEvents.slice(todayPageIndex * 2, todayPageIndex * 2 + 2)
  }, [data.todayEvents, todayPageCount, todayPageIndex])

  const handleTodayTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    todayTouchStart.current = { x: touch.clientX, y: touch.clientY }
    todayTouchCurrent.current = { x: touch.clientX, y: touch.clientY }
    setTodaySwipeDirection(null)
  }

  const handleTodayTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!todayTouchStart.current || event.touches.length !== 1) return
    const touch = event.touches[0]
    todayTouchCurrent.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTodayTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = todayTouchStart.current
    todayTouchStart.current = null
    const current = todayTouchCurrent.current
    todayTouchCurrent.current = null
    if (!start) return
    const eventCount = data.todayEvents.length
    if (eventCount < 2) return
    const touch = event.changedTouches[0]
    const endX = current?.x ?? touch?.clientX ?? start.x
    const endY = current?.y ?? touch?.clientY ?? start.y
    const deltaX = endX - start.x
    const deltaY = endY - start.y
    const swipeThreshold = 48
    if (Math.abs(deltaX) < swipeThreshold || Math.abs(deltaX) <= Math.abs(deltaY)) return
    setTodaySwipeDirection(deltaX < 0 ? 'next' : 'previous')
    setTodayEventIndex((currentIndex) => (currentIndex + (deltaX < 0 ? 1 : -1) + eventCount) % eventCount)
    setTodayAutoplayReset((current) => current + 1)
  }

  const renderDailyMusicPanel = () => (
    <section className="community-panel music-panel home-daily-music-panel" aria-label="EasMusic 今日推荐">
      <header><h2>{homeText.dailyMusic}</h2><Link href={data.dailyMusic ? `/music/song/${data.dailyMusic.id}` : '/music'} className="home-module-entry">{homeText.viewDetails} {'>>'}</Link></header>
      {data.dailyMusic ? <div className="home-daily-music">
        <div className="home-daily-music-cover">
          {dailyMusicCoverUrl ? <Image src={dailyMusicCoverUrl} alt={`${data.dailyMusic.title} album cover`} fill sizes="96px" priority className="object-cover" onError={() => { if (process.env.NODE_ENV === 'development') console.log('album cover load failed', dailyMusicCoverUrl) }} /> : <span aria-hidden="true">♫</span>}
        </div>
        <div className="home-daily-music-copy">
          <span>{data.dailyMusic.artist}</span>
          <h3>{data.dailyMusic.title}</h3>
          <p>{data.dailyMusic.album.name} · {data.dailyMusic.releaseYear}</p>
          <div className="home-daily-music-lyrics">{data.dailyMusic.lyrics || homeText.noLyrics}</div>
          <HomeDailyMusicPreview music={data.dailyMusic} />
        </div>
      </div> : <p className="community-empty">{homeText.noMusic}</p>}
    </section>
  )

  const renderEntertainmentPanel = () => (
    <section className="community-panel home-entertainment-panel" aria-label="Entertainment ranking">
      <header><h2>{homeText.entertainment}</h2><Link href="/games" className="home-module-entry">{homeText.rankingMore} {'>>'}</Link></header>
      <div className="home-entertainment-content">
        <div className="home-entertainment-mobile-score">
          {data.entertainmentRanking?.status === 'ready' && topRanking ? <>
            <span className="home-entertainment-ranking-caption">{homeText.rankingBest}</span>
            <EntertainmentScoreUser score={topRanking} />
            <strong className="home-entertainment-mobile-mode">{modeLabels[topRanking.mode]}模式</strong>
            <strong className="home-entertainment-mobile-score-value">{fmt(topRanking.score)} <small>分</small></strong>
          </> : data.entertainmentRanking?.status === 'empty' ? <p className="community-empty home-entertainment-empty">{homeText.noRanking}</p> : data.entertainmentRanking?.status === 'unavailable' ? <p className="community-empty home-entertainment-empty">{homeText.rankingUnavailable}</p> : <p className="community-empty home-entertainment-empty">{homeText.rankingLoading}</p>}
        </div>
        <div className="home-entertainment-desktop-scores">
          {data.entertainmentRanking?.status === 'ready' ? GUESS_SONG_PUBLIC_MODES.map((mode) => {
            const score = entertainmentModes[mode]
            return <div className="home-entertainment-mode-score" key={mode}>
              <span className="home-entertainment-mode-label">{modeLabels[mode]}模式</span>
              {score ? <>
                <EntertainmentScoreUser score={score} />
                <strong className="home-entertainment-mode-score-value">{fmt(score.score)} <small>分</small></strong>
              </> : <span className="home-entertainment-mode-empty">暂无成绩</span>}
            </div>
          }) : <p className="community-empty home-entertainment-empty">{data.entertainmentRanking?.status === 'empty' ? homeText.noRanking : data.entertainmentRanking?.status === 'unavailable' ? homeText.rankingUnavailable : homeText.rankingLoading}</p>}
        </div>
        <Link href="/games" className="hero-primary-button home-entertainment-button">{homeText.rankingMore} →</Link>
      </div>
    </section>
  )

  // 今日模块：≤2 条直接展开为普通列表；桌面端 >2 条显示双卡轮播，移动端保留单卡轮播。
  const renderTodayPanel = () => {
    const events = data.todayEvents
    return (
      <section className={`community-panel concert-panel home-today-panel${device === 'mobile' ? ' mb-5' : ''}`} aria-label="Today in history">
        <header><h2>{homeText.today}</h2><Link href="/today" className="home-module-entry">{homeText.todayMore} {'>>'}</Link></header>
        <div className="home-today-content">
        {events.length === 0 ? <p className="community-empty">{homeText.noToday}</p> : null}
        {events.length > 0 && events.length <= 2 ? (
          <div className="home-today-list">
            {events.map((event) => (
              <Link key={event.id} href={event.href || '/today'} className="home-today-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-subtle)', color: 'var(--foreground)', textDecoration: 'none' }}>
                <div className="home-today-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <time className="text-[11px] font-bold whitespace-nowrap text-sky-700" style={{ display: 'block', whiteSpace: 'nowrap' }}>{formatTodayDate(event.year, event.month, event.day)}</time>
                  <b className="text-[11px] font-bold whitespace-nowrap text-slate-500" style={{ display: 'block', whiteSpace: 'nowrap' }}>{homeText.distance} {yearsFromToday(event.date)} {homeText.years}</b>
                </div>
                <strong className="home-today-title block text-sm font-bold leading-snug break-words" style={{ display: 'block', minWidth: 0, overflowWrap: 'anywhere' }}>{event.title}</strong>
                <small className="home-today-desc block truncate text-[11px] text-slate-500" style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{todayTypeLabels[event.type] || event.type} · {excerpt(event.content, 46)}</small>
              </Link>
            ))}
          </div>
        ) : events.length > 2 ? (
          <div>
            {device === 'desktop' ? (
              <div className="home-today-desktop-carousel">
                {desktopTodayEvents.map((event) => (
                  <Link key={event.id} href={event.href || '/today'} className="home-today-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-subtle)', color: 'var(--foreground)', textDecoration: 'none' }}>
                    <div className="home-today-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <time className="text-[11px] font-bold whitespace-nowrap text-sky-700" style={{ display: 'block', whiteSpace: 'nowrap' }}>{formatTodayDate(event.year, event.month, event.day)}</time>
                      <b className="text-[11px] font-bold whitespace-nowrap text-slate-500" style={{ display: 'block', whiteSpace: 'nowrap' }}>{homeText.distance} {yearsFromToday(event.date)} {homeText.years}</b>
                    </div>
                    <strong className="home-today-title block text-sm font-bold leading-snug break-words" style={{ display: 'block', minWidth: 0, overflowWrap: 'anywhere' }}>{event.title}</strong>
                    <small className="home-today-desc block truncate text-[11px] text-slate-500" style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{todayTypeLabels[event.type] || event.type} · {excerpt(event.content, 46)}</small>
                  </Link>
                ))}
              </div>
            ) : <div className="home-today-mobile-carousel" data-swipe-direction={todaySwipeDirection || undefined} onTouchStart={handleTodayTouchStart} onTouchMove={handleTodayTouchMove} onTouchEnd={handleTodayTouchEnd} onTouchCancel={handleTodayTouchEnd}>
              {todayEvent ? <Link key={todayEvent.id} href={todayEvent.href || '/today'} onAnimationEnd={() => setTodaySwipeDirection(null)} className="home-today-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-subtle)', color: 'var(--foreground)', textDecoration: 'none' }}>
              <div className="home-today-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <time className="text-[11px] font-bold whitespace-nowrap text-sky-700" style={{ display: 'block', whiteSpace: 'nowrap' }}>{formatTodayDate(todayEvent.year, todayEvent.month, todayEvent.day)}</time>
                <b className="text-[11px] font-bold whitespace-nowrap text-slate-500" style={{ display: 'block', whiteSpace: 'nowrap' }}>{homeText.distance} {yearsFromToday(todayEvent.date)} {homeText.years}</b>
              </div>
              <strong className="home-today-title block text-sm font-bold leading-snug break-words" style={{ display: 'block', minWidth: 0, overflowWrap: 'anywhere' }}>{todayEvent.title}</strong>
              <small className="home-today-desc block truncate text-[11px] text-slate-500" style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{todayTypeLabels[todayEvent.type] || todayEvent.type} · {excerpt(todayEvent.content, 46)}</small>
              </Link> : null}
            </div>}
            <div className="home-today-desktop-carousel-controls" aria-label="今日事件分页控制"><button type="button" onClick={() => setTodayPageIndex((current) => (current - 1 + todayPageCount) % todayPageCount)} aria-label="上一页">←</button>{Array.from({ length: todayPageCount }, (_, pageIndex) => <button key={pageIndex} type="button" className={pageIndex === todayPageIndex ? 'is-active' : ''} onClick={() => setTodayPageIndex(pageIndex)} aria-label={'查看第 ' + (pageIndex + 1) + ' 页'}>●</button>)}<button type="button" onClick={() => setTodayPageIndex((current) => (current + 1) % todayPageCount)} aria-label="下一页">→</button></div>
            <div className="home-today-carousel-controls" aria-label="今日事件轮播控制"><button type="button" onClick={() => setTodayEventIndex((current) => (current - 1 + events.length) % events.length)} aria-label="上一条">←</button>{events.map((event, index) => <button key={event.id} type="button" className={index === todayEventIndex ? 'is-active' : ''} onClick={() => setTodayEventIndex(index)} aria-label={`查看第 ${index + 1} 条`}>●</button>)}<button type="button" onClick={() => setTodayEventIndex((current) => (current + 1) % events.length)} aria-label="下一条">→</button></div>
          </div>
        ) : null}
        </div>
      </section>
    )
  }

  return (
    <div className="community-home">
      <HomeHero
        slides={slides}
        siteName={siteConfig.text.siteName}
        buttonColor={siteConfig.colors.button}
        styleConfig={siteConfig.heroStyle}
        visual={siteConfig.heroVisuals.home}
        defaultTitle={siteConfig.text.homeSubtitle}
      />
      <div id="community-content" className="community-content">
        <section className="community-stats home-checkin-stats mb-4 sm:mb-6" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} aria-label="E院数据与签到状态">
          <div><span>{homeText.members}</span><strong>{data.siteStats ? fmt(data.siteStats.memberCount) : '—'}</strong></div>
          <Link href="/checkin" className={`stat-checkin ${checkinStateClass}`}>
            <span>{homeText.todayCheckins}</span>
            <strong>{data.stats ? (checkedIn ? fmt(data.siteStats?.todayCheckIns ?? 0) : homeText.notCheckedIn) : '—'}</strong>
            <small>{data.stats ? (checkedIn ? <><span className="stat-checkin-mobile-mark" aria-hidden="true">✓</span>{homeText.checkedIn}</> : homeText.goCheckin) : homeText.loadingStats}</small>
            {checkedIn ? <i aria-hidden="true">✓</i> : null}
          </Link>
          <div className="stat-total"><span>{homeText.totalCheckins}</span><strong>{data.stats ? `${fmt(data.stats._count.checkIns)} ${homeText.days}` : '—'}</strong><Link href="/checkin">{homeText.viewCheckin} →</Link></div>
          <div><span>{homeText.birthdays}</span><strong>{data.siteStats ? fmt(data.siteStats.todayBirthdays) : '—'}</strong></div>
        </section>

        {announcement && visible('home.announcement') ? <Link href={normalizeActionUrl(announcement.link) || normalizeActionUrl(announcement.buttonUrl) || '/forum'} className="community-announcement"><strong>{announcement.title}</strong><span>{announcement.content}</span></Link> : null}
        {failed ? <p className="community-error">{homeText.loadError}</p> : null}

        {device === 'mobile' ? (
          <>
            {renderTodayPanel()}
            <div className="home-mobile-dual">
              {renderEntertainmentPanel()}
              {renderDailyMusicPanel()}
            </div>
          </>
        ) : (
          <div className="community-columns home-primary-columns">
            {renderDailyMusicPanel()}
            {renderTodayPanel()}
            {renderEntertainmentPanel()}
          </div>
        )}

        <section className="community-panel music-panel home-full-panel home-albums-section" aria-label="每日推荐专辑">
          <header><h2>{homeText.randomAlbums}</h2><Link href="/music/albums">{homeText.albumsMore} →</Link></header>
          <div className="album-strip home-album-strip">
            {data.albums.slice(0, device === 'mobile' ? 3 : data.albums.length).map((album) => <Link key={album.id} href={`/music/album/${album.id}`}><span>{album.coverUrl ? <Image src={publicImageVariantUrl(album.coverUrl, 'thumb-sm') || album.coverUrl} alt={`${album.name} album cover`} fill sizes="(max-width:767px) 35vw, 130px" loading="lazy" className="object-cover" /> : '♫'}</span><strong>{album.name}</strong><small>{album.releaseYear}</small></Link>)}
            {!data.albums.length && !failed ? <p className="community-empty">{homeText.noAlbums}</p> : null}
          </div>
        </section>

        {visible('home.featuredPosts') || visible('home.latestPosts') ? <section className="community-panel posts-panel home-full-panel" aria-label="Featured posts"><header><h2>{layoutModule('home.featuredPosts')?.title || '精选帖子'}</h2><Link href="/forum" className="home-module-entry">更多内容 {'>>'}</Link></header><div className="post-list">{data.posts.slice(0, 4).map((post) => <article data-featured-post-card key={post.id}><Link data-post-card-link href={`/posts/${post.id}`} className="post-row-link absolute inset-0 z-[1] focus:outline-none focus-visible:ring-2" aria-label={`View post: ${post.title}`} /><div className="post-copy pointer-events-none relative z-[2]"><h3>
  {post.isPinned ? <b>{homeText.pinned}</b> : post.isFeatured ? <b>{homeText.featured}</b> : null}
  <span className="post-board-name">[{post.board.name}]</span>
  {post.title}
</h3><p><Link href={`/user/${formatUid(post.author.uid)}`} className="pointer-events-auto relative z-[3]">{post.author.profile?.displayName || post.author.nickname}</Link> · {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(post.createdAt))}</p></div><div className="post-metrics pointer-events-auto relative z-[3]"><span>Reply {post.replyCount}</span><span>Views {fmt(post.viewCount)}</span><div data-post-like-control className="pointer-events-auto relative z-[3]"><LikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} /></div></div></article>)}{!data.posts.length && !failed ? <p className="community-empty">{siteConfig.text.emptyText}</p> : null}</div></section> : null}

        <section className="community-panel concert-panel home-full-panel home-concerts-section" aria-label="Hot concerts">
          <header><h2>{homeText.hotConcerts}</h2><Link href="/music/concerts" className="home-module-entry">{homeText.concertsMore} {'>>'}</Link></header>
          <div className="home-concert-grid">
            {data.concerts.map((concert) => <Link key={concert.id} href={concert.href} className="home-concert-card">
              <span className="home-concert-cover">{concert.posterUrl ? <Image src={publicImageVariantUrl(concert.posterUrl, 'thumb-sm') || concert.posterUrl} alt={`${concert.title} poster`} fill sizes="72px" loading="lazy" className="object-cover" /> : 'Eason'}</span>
              <span className="home-concert-copy"><time>{shortDate(concert.concertDate)}</time><strong>{concert.title}</strong><small>{concert.city}{concert.venue ? ` · ${concert.venue}` : ''}</small><small>{concert.tourName}</small></span>
            </Link>)}
            {!data.concerts.length && !failed ? <p className="community-empty">{homeText.noConcerts}</p> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
