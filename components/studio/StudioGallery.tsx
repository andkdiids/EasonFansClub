'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getVisibleStudioTools } from '@/lib/studio/tools'
import type { StudioGalleryProject, StudioGallerySort } from '@/lib/studio/types'
import styles from './studio.module.css'

type GalleryResponse = {
  projects?: StudioGalleryProject[]
  total?: number
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
  } catch {
    return '最近更新'
  }
}

function PatternThumb() {
  return <span className={styles.projectThumbPattern} aria-hidden>{Array.from({ length: 100 }, (_, index) => <i key={index} className={styles.projectThumbCell} />)}</span>
}

function GalleryCard({ project, busy, onInteract }: Readonly<{ project: StudioGalleryProject; busy: string; onInteract: (project: StudioGalleryProject, kind: 'like' | 'favorite') => void }>) {
  const tool = getVisibleStudioTools().find((item) => item.slug === project.toolSlug)
  const likeCount = project.likeCount || 0
  const favoriteCount = project.favoriteCount || 0
  const downloadCount = project.downloadCount || 0
  return <article className={styles.galleryCard}>
    <Link href={`/studio/project/${encodeURIComponent(project.id)}`} className={styles.galleryThumbLink} aria-label={`查看作品：${project.title}`}>
      <div className={styles.galleryThumb}>{project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="作品缩略图" /> : <PatternThumb />}</div>
    </Link>
    <div className={styles.galleryContent}>
      <div className={styles.galleryTopline}><strong className={styles.galleryTitle} title={project.title}>{project.title}</strong><span className={styles.galleryTool}>{tool?.name || project.toolSlug}</span></div>
      <p className={styles.galleryMeta}>{project.author} · {formatDate(project.updatedAt)}</p>
      <div className={styles.galleryFacts}><span>{project.metadata?.width || '—'} × {project.metadata?.height || '—'}</span><span>{project.metadata?.totalBeads ?? '—'} 颗</span><span>{project.metadata?.colorCount ?? '—'} 色</span><span>↓ {downloadCount}</span></div>
      <div className={styles.galleryActions}>
        <button type="button" className={`${styles.galleryInteraction} ${project.isLiked ? styles.galleryInteractionActive : ''}`} onClick={() => onInteract(project, 'like')} disabled={busy === `${project.id}:like`} aria-pressed={project.isLiked}>{project.isLiked ? '♥' : '♡'} {likeCount}</button>
        <button type="button" className={`${styles.galleryInteraction} ${project.isFavorited ? styles.galleryInteractionFavorite : ''}`} onClick={() => onInteract(project, 'favorite')} disabled={busy === `${project.id}:favorite`} aria-pressed={project.isFavorited}>{project.isFavorited ? '★' : '☆'} {favoriteCount}</button>
        <Link href={`/studio/project/${encodeURIComponent(project.id)}`} className={`${styles.projectAction} ${styles.projectActionPrimary}`}>查看作品</Link>
      </div>
    </div>
  </article>
}

export function StudioGallery({ initialProjects }: Readonly<{ initialProjects: StudioGalleryProject[] }>) {
  const [projects, setProjects] = useState(initialProjects)
  const [sort, setSort] = useState<StudioGallerySort>('latest')
  const [toolSlug, setToolSlug] = useState('all')
  const [total, setTotal] = useState(initialProjects.length)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const query = new URLSearchParams({ sort, page: '1', pageSize: '48' })
    if (toolSlug !== 'all') query.set('tool', toolSlug)
    fetch(`/api/studio/gallery?${query.toString()}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as GalleryResponse : null)
      .then((body) => {
        if (cancelled || !body) return
        setProjects(Array.isArray(body.projects) ? body.projects : [])
        setTotal(typeof body.total === 'number' ? body.total : 0)
      })
      .catch(() => { if (!cancelled) setMessage('创作广场暂时无法刷新，正在显示最近内容。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sort, toolSlug])

  async function interact(project: StudioGalleryProject, kind: 'like' | 'favorite') {
    const key = `${project.id}:${kind}`
    if (busy) return
    setBusy(key)
    const active = kind === 'like' ? !project.isLiked : !project.isFavorited
    try {
      const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/${kind}`, { method: active ? 'POST' : 'DELETE' })
      const body = await response.json().catch(() => null) as { message?: string; likeCount?: number; favoriteCount?: number; isLiked?: boolean; isFavorited?: boolean } | null
      if (response.status === 401) {
        setMessage(`登录后才能${kind === 'like' ? '点赞' : '收藏'}作品。`)
        return
      }
      if (!response.ok || !body) throw new Error(body?.message || '操作失败，请稍后重试。')
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, likeCount: body.likeCount ?? item.likeCount, favoriteCount: body.favoriteCount ?? item.favoriteCount, isLiked: body.isLiked, isFavorited: body.isFavorited } : item))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '网络暂时不可用，请稍后重试。')
    } finally {
      setBusy('')
    }
  }

  return <main className={styles.galleryPage}>
    <header className={styles.galleryIntro}>
      <div><span className={styles.sectionKicker}>public works / 04</span><h1 className={styles.galleryTitleLarge}>创作广场</h1><p className={styles.galleryIntroSub}>看看大家把喜欢的画面，做成了什么样子。</p></div>
      <Link href="/studio/beads" className={`${styles.actionButton} ${styles.actionButtonPrimary}`}>＋ 开始新创作</Link>
    </header>
    <div className={styles.galleryControls}>
      <div className={styles.galleryTabs} role="tablist" aria-label="创作广场排序">
        <button type="button" role="tab" aria-selected={sort === 'latest'} className={`${styles.filterButton} ${sort === 'latest' ? styles.filterActive : ''}`} onClick={() => setSort('latest')}>最新</button>
        <button type="button" role="tab" aria-selected={sort === 'hot'} className={`${styles.filterButton} ${sort === 'hot' ? styles.filterActive : ''}`} onClick={() => setSort('hot')}>热门</button>
      </div>
      <div className={styles.galleryFilters} role="tablist" aria-label="创作工具筛选">
        <button type="button" role="tab" aria-selected={toolSlug === 'all'} className={`${styles.filterButton} ${toolSlug === 'all' ? styles.filterActive : ''}`} onClick={() => setToolSlug('all')}>全部工具</button>
        {getVisibleStudioTools().map((tool) => <button key={tool.slug} type="button" role="tab" aria-selected={toolSlug === tool.slug} className={`${styles.filterButton} ${toolSlug === tool.slug ? styles.filterActive : ''}`} onClick={() => setToolSlug(tool.slug)}>{tool.name}</button>)}
      </div>
      <span className={styles.galleryCount}>{loading ? '正在刷新…' : `${total} 件公开作品`}</span>
    </div>
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    {projects.length ? <div className={styles.galleryGrid}>{projects.map((project) => <GalleryCard key={project.id} project={project} busy={busy} onInteract={interact} />)}</div> : <div className={styles.emptyState}><p>暂时还没有公开作品</p><small>完成一张图纸并申请公开，就能出现在这里。</small><Link href="/studio/beads" className={`${styles.actionButton} ${styles.actionButtonPrimary}`} style={{ marginTop: 16 }}>开始制作</Link></div>}
  </main>
}
