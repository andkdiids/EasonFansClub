'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { HomeHero } from '@/components/HomeHero'
import { HomeSystemAnnouncement } from '@/components/HomeSystemAnnouncement'
import { ModuleFallback } from '@/components/ModuleFallback'
import { PageLayoutRenderer, type PageLayoutRenderContext, type PageLayoutRendererModules } from '@/components/page-layout/PageLayoutRenderer'
import { getMood } from '@/lib/daily'
import type { PageLayoutConfig, PageLayoutModuleConfig } from '@/lib/page-layout/types'
import type { SiteAppearanceConfig, SiteHeroSlide } from '@/lib/site-config'
import { formatUid } from '@/lib/uid'

type LoadState<T> = { loading: boolean; failed: boolean; data: T }
type Announcement = {
  id: string
  title: string
  content: string
  type: string
  link: string | null
  buttonUrl: string | null
}
type Post = {
  id: string
  title: string
  content: string
  likeCount: number
  replyCount: number
  viewCount: number
  isPinned: boolean
  isFeatured: boolean
  board: { name: string; slug: string }
  author: { uid: number; nickname: string; level: number; profile?: { displayName: string | null } | null }
}
type DailyMessage = {
  id: string
  mood: string
  content: string
  user: { uid: number; nickname: string; level: number; profile?: { displayName: string | null } | null }
}
type Activity = { id: string; title: string; description: string | null }
type Track = { id: string; title: string; artist: string }

function initial<T>(data: T): LoadState<T> {
  return { loading: true, failed: false, data }
}

async function loadJson<T>(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(url)
  return (await response.json()) as T
}

function ModuleHeading({ item, fallbackTitle, fallbackSubtitle }: { item: PageLayoutModuleConfig; fallbackTitle: string; fallbackSubtitle?: string }) {
  const title = item.title || fallbackTitle
  const subtitle = item.subtitle || fallbackSubtitle
  return (
    <div className="mb-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">{item.key}</p>
      <h2 className="mt-1 text-2xl font-black text-brand-950 sm:text-3xl">{title}</h2>
      {subtitle ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{subtitle}</p> : null}
    </div>
  )
}

export function HomeLayoutSurface({
  layoutConfig,
  siteConfig,
  slides,
  announcement,
}: {
  layoutConfig: PageLayoutConfig
  siteConfig: SiteAppearanceConfig
  slides: SiteHeroSlide[]
  announcement: Announcement | null
}) {
  const [posts, setPosts] = useState<LoadState<Post[]>>(initial([]))
  const [messages, setMessages] = useState<LoadState<DailyMessage[]>>(initial([]))
  const [activities, setActivities] = useState<LoadState<Activity[]>>(initial([]))
  const [tracks, setTracks] = useState<LoadState<Track[]>>(initial([]))

  useEffect(() => {
    loadJson<{ posts: Post[]; messages: DailyMessage[]; activities: Activity[]; tracks: Track[] }>('/api/home')
      .then((data) => {
        setPosts({ loading: false, failed: false, data: data.posts })
        setMessages({ loading: false, failed: false, data: data.messages })
        setActivities({ loading: false, failed: false, data: data.activities })
        setTracks({ loading: false, failed: false, data: data.tracks })
      })
      .catch(() => {
        setPosts({ loading: false, failed: true, data: [] })
        setMessages({ loading: false, failed: true, data: [] })
        setActivities({ loading: false, failed: true, data: [] })
        setTracks({ loading: false, failed: true, data: [] })
      })
  }, [])

  function renderModule(item: PageLayoutModuleConfig, context: PageLayoutRenderContext) {
    const isCompact = context.density !== 'normal'
    const isMinimal = context.density === 'minimal'

    if (item.key === 'home.hero') {
      const heroSlides = item.title || item.subtitle
        ? slides.map((slide, index) => (index === 0 ? { ...slide, title: item.title || slide.title, subtitle: item.subtitle || slide.subtitle } : slide))
        : slides
      return <HomeHero slides={heroSlides} siteName={siteConfig.text.siteName} buttonColor={siteConfig.colors.button} density={context.density} />
    }

    if (item.key === 'home.announcement') return <HomeSystemAnnouncement announcement={announcement} />

    if (item.key === 'home.checkinSummary') {
      return (
        <div className={`${isMinimal ? 'grid-cols-3 gap-2' : isCompact ? 'gap-3 md:grid-cols-3' : 'gap-4 md:grid-cols-3'} grid h-full min-h-0`}>
          {[
            [siteConfig.text.homePrimaryButton || '今日挂号', siteConfig.text.checkinCopy || '留下今天的心情', '/checkin'],
            [siteConfig.text.homeSecondaryButton || '去E院广场看看', siteConfig.text.forumCopy || '帖子、留言、慢慢说。', '/boards/announcements'],
            ['EasMusic', siteConfig.text.musicCopy || '一首歌，也是一段故事。', '/music'],
          ].map(([title, copy, href]) => (
            <Link
              key={href}
              href={href}
              className={`${isMinimal ? 'rounded-xl p-2' : isCompact ? 'rounded-2xl p-3' : 'layout-card rounded-2xl'} min-h-0 bg-white/86 shadow-xl shadow-sky-900/5 transition hover:-translate-y-1`}
            >
              <h2 className={`${isMinimal ? 'text-sm leading-tight' : isCompact ? 'text-xl' : 'text-2xl'} font-black text-brand-950`}>{title}</h2>
              <p className={`${isMinimal ? 'mt-1 line-clamp-1 text-[11px] leading-4' : isCompact ? 'mt-1 line-clamp-1 text-xs leading-5' : 'mt-3 min-h-14 text-base leading-7'} font-bold text-slate-600`}>{copy}</p>
              <span className={`${isMinimal ? 'mt-1.5 px-2.5 py-1 text-[11px]' : isCompact ? 'mt-2 px-3 py-1.5 text-xs' : 'mt-5 px-4 py-2 text-sm'} inline-flex rounded-full bg-sky-100 font-black text-brand-700`}>打开</span>
            </Link>
          ))}
        </div>
      )
    }

    if (item.key === 'home.featuredPosts' || item.key === 'home.latestPosts') {
      return (
        <div>
          <div className="flex items-end justify-between gap-4">
            <ModuleHeading item={item} fallbackTitle={item.key === 'home.latestPosts' ? '最新动态' : 'E院广场精选'} />
            <Link href="/posts/new" className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">发布帖子</Link>
          </div>
          {posts.failed ? <ModuleFallback /> : null}
          {posts.loading ? <ModuleFallback title="正在加载帖子..." /> : null}
          {!posts.loading && !posts.failed ? (
            <div className="grid gap-3">
              {posts.data.map((post) => {
                const authorName = post.author.profile?.displayName || post.author.nickname
                return (
                  <article key={post.id} className="layout-card rounded-xl border border-sky-100 bg-white/82 shadow-sm">
                    <div className="mb-3 flex flex-wrap gap-2">
                      {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">Pinned</span> : null}
                      {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">Featured</span> : null}
                      <Link href={`/boards/${post.board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{post.board.name}</Link>
                    </div>
                    <Link href={`/posts/${post.id}`} className="text-xl font-black text-brand-950 hover:text-brand-700 sm:text-2xl">{post.title}</Link>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
                    <p className="mt-4 text-xs font-bold text-slate-500">
                      <Link href={`/user/${formatUid(post.author.uid)}`} className="text-brand-950">{authorName}</Link>
                      {' '}回复 {post.replyCount} 赞 {post.likeCount} 浏览 {post.viewCount}
                    </p>
                  </article>
                )
              })}
              {!posts.data.length ? <ModuleFallback title={siteConfig.text.emptyText} /> : null}
            </div>
          ) : null}
        </div>
      )
    }

    if (item.key === 'home.dailyMessages') {
      return (
        <div className="layout-card rounded-[24px] bg-white/78 shadow-xl shadow-sky-900/5 backdrop-blur">
          <ModuleHeading item={item} fallbackTitle="E友留言精选" fallbackSubtitle="今天大家留下的声音。" />
          <div className="layout-stack grid">
            {messages.failed ? <ModuleFallback /> : null}
            {messages.loading ? <ModuleFallback title="正在加载留言..." /> : null}
            {!messages.loading && !messages.failed && messages.data.map((message) => {
              const mood = getMood(message.mood)
              const name = message.user.profile?.displayName || message.user.nickname
              return (
                <article key={message.id} className="rounded-2xl bg-sky-50/80 p-4">
                  <p className="font-black text-brand-950">{mood?.icon || '*'} {name} Lv.{message.user.level}</p>
                  <p className="mt-2 line-clamp-2 leading-7 text-slate-600">{message.content}</p>
                </article>
              )
            })}
            {!messages.loading && !messages.failed && !messages.data.length ? <ModuleFallback title={siteConfig.text.emptyText} /> : null}
          </div>
        </div>
      )
    }

    if (item.key === 'home.music') {
      return (
        <div className="layout-card rounded-[24px] bg-white/78 shadow-xl shadow-sky-900/5 backdrop-blur">
          <ModuleHeading item={item} fallbackTitle="EasMusic" fallbackSubtitle="一首歌，也是一段故事。" />
          <div className="layout-stack grid">
            {tracks.failed ? <ModuleFallback /> : null}
            {tracks.loading ? <ModuleFallback title="正在加载音乐..." /> : null}
            {!tracks.loading && !tracks.failed && tracks.data.map((track) => (
              <Link key={track.id} href="/music" className="rounded-2xl bg-sky-50/80 p-4 font-black text-slate-700">{track.title}</Link>
            ))}
          </div>
        </div>
      )
    }

    if (item.key === 'home.culture') {
      return (
        <div className="layout-card rounded-[24px] bg-white/78 shadow-xl shadow-sky-900/5 backdrop-blur">
          <ModuleHeading item={item} fallbackTitle="活动与文化" fallbackSubtitle="下一场活动和新的文化内容。" />
          {activities.failed ? <ModuleFallback /> : null}
          {activities.loading ? <p className="mt-4 text-base font-bold leading-7 text-slate-600">正在加载活动...</p> : null}
          {!activities.loading && !activities.failed ? (
            <p className="mt-4 text-base font-bold leading-7 text-slate-600">{activities.data[0]?.title || '下一场活动，正在准备。'}</p>
          ) : null}
        </div>
      )
    }

    if (item.key === 'home.footer') {
      return <footer className="pb-8 text-center text-sm font-bold text-slate-500">{item.title || siteConfig.text.footerText}</footer>
    }

    return null
  }

  const rendererModules: PageLayoutRendererModules = {
    'home.hero': renderModule,
    'home.announcement': renderModule,
    'home.checkinSummary': renderModule,
    'home.featuredPosts': renderModule,
    'home.latestPosts': renderModule,
    'home.dailyMessages': renderModule,
    'home.music': renderModule,
    'home.culture': renderModule,
    'home.footer': renderModule,
  }

  return <PageLayoutRenderer pageKey="home" config={layoutConfig} modules={rendererModules} className="mx-auto max-w-7xl" />
}
