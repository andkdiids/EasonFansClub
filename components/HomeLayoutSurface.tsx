'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { HomeHero } from '@/components/HomeHero'
import { HomeSystemAnnouncement } from '@/components/HomeSystemAnnouncement'
import { ModuleFallback } from '@/components/ModuleFallback'
import { LikeButton } from '@/components/PostActions'
import { PageLayoutRenderer, type PageLayoutRendererModules } from '@/components/page-layout/PageLayoutRenderer'
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
  likedByMe: boolean
  board: { name: string; slug: string }
  author: { uid: number; nickname: string; level: number; profile?: { displayName: string | null } | null }
}
type DailyMessage = {
  id: string
  mood: string | null
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
  const [dailyMessagesHidden, setDailyMessagesHidden] = useState(false)

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

  useEffect(() => setDailyMessagesHidden(window.localStorage.getItem('home:dailyMessages:hidden') === '1'), [])

  function renderModule(item: PageLayoutModuleConfig) {
    if (item.key === 'home.hero') {
      const heroSlides = item.title || item.subtitle
        ? slides.map((slide, index) => (index === 0 ? { ...slide, title: item.title || slide.title, subtitle: item.subtitle || slide.subtitle } : slide))
        : slides
      return <HomeHero slides={heroSlides} siteName={siteConfig.text.siteName} buttonColor={siteConfig.colors.button} styleConfig={siteConfig.heroStyle} />
    }

    if (item.key === 'home.announcement') return <HomeSystemAnnouncement announcement={announcement} />

    const quickEntries: Record<string, [string, string, string]> = {
      'home.checkinEntry': [siteConfig.text.homePrimaryButton || '今日挂号', siteConfig.text.checkinCopy || '留下今天的心情', '/checkin'],
      'home.forumEntry': [siteConfig.text.homeSecondaryButton || '去E院广场看看', siteConfig.text.forumCopy || '帖子、留言、慢慢说。', '/forum'],
      'home.musicEntry': ['EasMusic', siteConfig.text.musicCopy || '一首歌，也是一段故事。', '/music'],
    }
    if (quickEntries[item.key]) {
      const [title, copy, href] = quickEntries[item.key]
      return (
        <Link href={href} className="flex min-h-28 flex-col justify-between rounded-2xl border border-sky-100 bg-white/86 p-4 shadow-sm transition hover:-translate-y-1">
          <div><h2 className="text-lg font-black text-brand-950">{item.title || title}</h2><p className="mt-1 line-clamp-2 text-sm font-bold leading-6 text-slate-600">{item.subtitle || copy}</p></div>
          <span className="mt-3 w-fit rounded-full bg-sky-100 px-3 py-1.5 text-xs font-black text-brand-700">打开</span>
        </Link>
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
            <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2 md:gap-4">
              {posts.data.slice(0, 4).map((post) => {
                const authorName = post.author.profile?.displayName || post.author.nickname
                return (
                  <article data-featured-post-card key={post.id} className="relative min-w-0 cursor-pointer rounded-2xl border border-sky-100 bg-white/88 px-4 py-4 shadow-sm transition duration-200 hover:-translate-y-px hover:border-sky-200 hover:shadow-md active:scale-[0.99] sm:p-5">
                    <Link data-post-card-link href={`/posts/${post.id}`} aria-label={`查看帖子：${post.title}`} className="absolute inset-0 z-[1] rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2" />
                    <div className="pointer-events-none relative z-[2] mb-2 flex w-fit flex-wrap gap-2">
                      {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">Pinned</span> : null}
                      {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">Featured</span> : null}
                      <Link href={`/forum?board=${encodeURIComponent(post.board.slug)}`} className="pointer-events-auto relative z-[3] rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{post.board.name}</Link>
                    </div>
                    <h3 className="pointer-events-none relative z-[2] line-clamp-2 text-lg font-black text-brand-950 sm:text-xl">{post.title}</h3>
                    {post.content.trim() ? <p className="pointer-events-none relative z-[2] mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p> : null}
                    <div className="pointer-events-none relative z-[2] mt-4 flex min-w-0 items-center gap-2 text-xs font-bold text-slate-500">
                      <Link href={`/user/${formatUid(post.author.uid)}`} className="pointer-events-auto relative z-[3] max-w-[32%] truncate text-brand-950">{authorName}</Link>
                      <span className="shrink-0">回复 {post.replyCount}</span><span className="shrink-0">浏览 {post.viewCount}</span>
                      <div data-post-like-control className="pointer-events-auto relative z-[3] ml-auto shrink-0 [&_button]:px-3 [&_button]:py-1.5"><LikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} /></div>
                    </div>
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
      if (dailyMessagesHidden) return null
      return (
        <div className="layout-card rounded-[24px] bg-white/78 shadow-xl shadow-sky-900/5 backdrop-blur">
          <div className="flex items-start justify-between gap-3"><ModuleHeading item={item} fallbackTitle="E友留言精选" fallbackSubtitle="今天大家留下的声音。" /><button type="button" onClick={() => { window.localStorage.setItem('home:dailyMessages:hidden', '1'); setDailyMessagesHidden(true) }} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-slate-500">关闭</button></div>
          <div className="layout-stack grid">
            {messages.failed ? <ModuleFallback /> : null}
            {messages.loading ? <ModuleFallback title="正在加载留言..." /> : null}
            {!messages.loading && !messages.failed && messages.data.map((message) => {
              const mood = getMood(message.mood)
              const name = message.user.profile?.displayName || message.user.nickname
              return (
                <article key={message.id} className="rounded-2xl bg-sky-50/80 p-4">
                  <p className="font-black text-brand-950">{mood ? `${mood.icon} ` : ''}{name} Lv.{message.user.level}</p>
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
      return (
        <footer className="pb-8 text-center text-sm text-slate-500">
          <div className="font-bold">
            {item.title || siteConfig.text.footerText}
          </div>

          <a
            href="https://beian.miit.gov.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block transition-colors hover:text-sky-500"
          >
            粤ICP备2026099247号-1
          </a>
        </footer>
      )
    }

    return null
  }

  const rendererModules: PageLayoutRendererModules = {
    'home.hero': renderModule,
    'home.announcement': renderModule,
    'home.checkinEntry': renderModule,
    'home.forumEntry': renderModule,
    'home.musicEntry': renderModule,
    'home.featuredPosts': renderModule,
    'home.latestPosts': renderModule,
    'home.dailyMessages': renderModule,
    'home.music': renderModule,
    'home.culture': renderModule,
    'home.footer': renderModule,
  }

  return <PageLayoutRenderer pageKey="home" config={layoutConfig} modules={rendererModules} className="mx-auto max-w-7xl" />
}
