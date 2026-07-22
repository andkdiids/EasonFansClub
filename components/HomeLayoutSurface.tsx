'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { LikeButton } from '@/components/PostActions'
import { HeroBackground } from '@/components/HeroBackground'
import { getPageLayoutModules } from '@/components/page-layout/PageLayoutRenderer'
import type { PageLayoutConfig, PageLayoutDevice } from '@/lib/page-layout/types'
import type { SiteAppearanceConfig, SiteHeroSlide } from '@/lib/site-config'
import { formatUid } from '@/lib/uid'

type Announcement = { id: string; title: string; content: string; link: string | null; buttonUrl: string | null }
type Post = { id: string; title: string; content: string; likeCount: number; likedByMe: boolean; replyCount: number; viewCount: number; isPinned: boolean; createdAt: string; board: { name: string }; author: { uid: number; nickname: string; profile?: { displayName: string | null } | null } }
type Activity = { id: string; title: string; description: string | null; startsAt: string | null; endsAt: string | null }
type Album = { id: string; name: string; releaseYear: number; coverUrl: string | null }
type Stats = { level: number; experience: number; points: number; consecutiveDays: number; checkIns: { id: string }[]; _count: { checkIns: number } }
type Payload = { posts: Post[]; activities: Activity[]; albums: Album[]; stats: Stats | null }

const growthThresholds = [0, 1000, 3000, 7000, 12000, 18000, 25000]

function growthSummary(experience: number) {
  const safe = Math.max(0, Math.floor(experience || 0))
  const index = Math.max(0, growthThresholds.findLastIndex((value) => safe >= value))
  const current = growthThresholds[index]
  const next = growthThresholds[index + 1] ?? null
  return { experience: safe, nextRequiredExp: next, progressPercent: next ? Math.min(100, Math.round(((safe - current) / (next - current)) * 100)) : 100 }
}

function useDevice(): PageLayoutDevice {
  const [device, setDevice] = useState<PageLayoutDevice>('desktop')
  useEffect(() => {
    const mobile = matchMedia('(max-width:767px)'); const tablet = matchMedia('(max-width:1100px)')
    const update = () => setDevice(mobile.matches ? 'mobile' : tablet.matches ? 'tablet' : 'desktop')
    update(); mobile.addEventListener('change', update); tablet.addEventListener('change', update)
    return () => { mobile.removeEventListener('change', update); tablet.removeEventListener('change', update) }
  }, [])
  return device
}

export function HomeLayoutSurface({ layoutConfig, siteConfig, slides, announcement }: { layoutConfig: PageLayoutConfig; siteConfig: SiteAppearanceConfig; slides: SiteHeroSlide[]; announcement: Announcement | null }) {
  const device = useDevice()
  const items = useMemo(() => getPageLayoutModules(layoutConfig, device, 'home'), [layoutConfig, device])
  const layoutModule = (key: string) => items.find((item) => item.key === key)
  const visible = (key: string) => Boolean(layoutModule(key))
  const [data, setData] = useState<Payload>({ posts: [], activities: [], albums: [], stats: null })
  const [failed, setFailed] = useState(false)
  const hero = slides.filter((item) => item.isVisible).sort((a,b) => a.sortOrder-b.sortOrder)[0]
  const growth = growthSummary(data.stats?.experience || 0)
  const fmt = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
  const activityStatus = (item: Activity) => item.endsAt && new Date(item.endsAt) < new Date() ? '已结束' : item.startsAt && new Date(item.startsAt) <= new Date() ? '进行中' : '未开始'

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/home', { cache: 'no-store', signal: controller.signal }).then((response) => { if (!response.ok) throw new Error(); return response.json() }).then(setData).catch((error) => { if (error.name !== 'AbortError') setFailed(true) })
    return () => controller.abort()
  }, [])

  return <div className="community-home">
      <section className="community-hero">
        <HeroBackground visual={siteConfig.heroVisuals.home} fallbackImageUrl={hero?.imageUrl} priority />{!siteConfig.heroVisuals.home.enabled || (!siteConfig.heroVisuals.home.imageUrl && !hero?.imageUrl) ? <div className="community-hero-fallback"/> : null}<div className="community-hero-overlay"/>
        <div className="community-hero-copy"><p>WELCOME BACK</p><h1>EASON<span>FANS CLUB</span></h1><h2>全球陈奕迅粉丝社区 · 私家E院</h2><em>C’mon in~</em><a href="#community-content" className="hero-primary-button">浏览今日内容 <span aria-hidden>›</span></a></div>
      </section>
      <div id="community-content" className="community-content">
        {announcement&&visible('home.announcement')?<Link href={announcement.link||announcement.buttonUrl||'/forum'} className="community-announcement"><strong>{announcement.title}</strong><span>{announcement.content}</span></Link>:null}
        {visible('home.checkinEntry')?<section className="community-stats" aria-label="用户数据">
          <Link href="/checkin" className="stat-checkin"><span>今日挂号</span><strong>{data.stats?.checkIns.length?'已签到':'去签到'}</strong><small>{data.stats?`连续签到 ${data.stats.consecutiveDays} 天 · 累计 ${data.stats._count.checkIns} 天`:'正在读取签到数据'}</small>{data.stats?.checkIns.length?<i>✓</i>:null}</Link>
          <div><span>等级</span><strong>Lv.{data.stats?.level??'—'}</strong><div className="stat-progress"><i style={{width:`${growth.progressPercent}%`}}/></div><small>{growth.nextRequiredExp?`${fmt(growth.experience)} / ${fmt(growth.nextRequiredExp)}`:fmt(growth.experience)}</small></div>
          <div><span>经验值</span><strong>{data.stats?fmt(data.stats.experience):'—'}</strong></div>
          <div><span>E积分</span><strong>{data.stats?fmt(data.stats.points):'—'}</strong></div>
          <div className="stat-total"><span>累计签到</span><strong>{data.stats?`${fmt(data.stats._count.checkIns)} 天`:'—'}</strong><Link href="/checkin">查看签到记录 ›</Link></div>
        </section>:null}
        {failed?<p className="community-error">部分社区内容暂时无法载入，请稍后刷新。</p>:null}
        <div className="community-columns">
          {visible('home.featuredPosts')||visible('home.latestPosts')?<section className="community-panel posts-panel"><header><h2>{layoutModule('home.featuredPosts')?.title||'精选帖子'}</h2><Link href="/forum">更多 ›</Link></header><div className="post-list">{data.posts.slice(0,4).map((post)=><article data-featured-post-card key={post.id}><Link data-post-card-link href={`/posts/${post.id}`} className="post-row-link absolute inset-0 z-[1] focus:outline-none focus-visible:ring-2" aria-label={`查看帖子：${post.title}`}/><span className="post-thumb pointer-events-none relative z-[2]">{post.title[0]}</span><div className="post-copy pointer-events-none relative z-[2]"><h3>{post.isPinned?<b>置顶</b>:null}<span>[{post.board.name}]</span> {post.title}</h3><p><Link href={`/user/${formatUid(post.author.uid)}`} className="pointer-events-auto relative z-[3]">{post.author.profile?.displayName||post.author.nickname}</Link> · {new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(post.createdAt))}</p></div><div className="post-metrics pointer-events-auto relative z-[3]"><span>▢ {post.replyCount}</span><span>◇ {fmt(post.viewCount)}</span><div data-post-like-control className="pointer-events-auto relative z-[3]"><LikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount}/></div></div></article>)}{!data.posts.length&&!failed?<p className="community-empty">{siteConfig.text.emptyText}</p>:null}</div></section>:null}
          <div className="community-right-column">
            {visible('home.music')||visible('home.musicEntry')?<section className="community-panel music-panel"><header><h2>{layoutModule('home.music')?.title||'EasMusic 精选'}</h2><Link href="/music/albums">更多 ›</Link></header><div className="album-strip">{data.albums.map((album)=><Link key={album.id} href={`/music/album/${album.id}`}><span>{album.coverUrl?<Image src={album.coverUrl} alt={`${album.name}专辑封面`} fill sizes="(max-width:767px) 35vw, 130px" className="object-cover"/>:'♪'}</span><strong>{album.name}</strong><small>{album.releaseYear}</small></Link>)}{!data.albums.length&&!failed?<p className="community-empty">暂无已发布专辑。</p>:null}</div></section>:null}
            {visible('home.culture')?<section className="community-panel concert-panel"><header><h2>{layoutModule('home.culture')?.title||'近期演唱会'}</h2><Link href="/activities">更多 ›</Link></header><div>{data.activities.map((activity)=><Link key={activity.id} href="/activities"><time>{activity.startsAt?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit'}).format(new Date(activity.startsAt)):'待定'}</time><span><strong>{activity.title}</strong><small>{activity.description||'详情请见活动页面'}</small></span><b>{activityStatus(activity)}</b></Link>)}{!data.activities.length&&!failed?<p className="community-empty">暂无已发布活动。</p>:null}</div></section>:null}
          </div>
        </div>
      </div>
  </div>
}
