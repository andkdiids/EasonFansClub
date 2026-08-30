'use client'

/* 沙龙图片来自受控 COS URL；卡片缩略图由现有图片变体管线提供。 */
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useState } from 'react'
import {
  SALON_CATEGORY_LABELS,
  SALON_POST_STATUSES,
  SALON_STATUS_LABELS,
  type SalonPostStatusValue,
  type SalonPostView,
} from '@/lib/salon'

export function SalonMine({ initialPosts }: Readonly<{ initialPosts: SalonPostView[] }>) {
  const [posts, setPosts] = useState(initialPosts)
  const [filter, setFilter] = useState<SalonPostStatusValue | 'ALL'>('ALL')
  const [busyId, setBusyId] = useState<string | null>(null)
  const visiblePosts = filter === 'ALL' ? posts : posts.filter((post) => post.status === filter)

  async function remove(post: SalonPostView) {
    if (busyId || !window.confirm('确定删除这篇沙龙作品吗？删除后无法恢复。')) return
    setBusyId(post.id)
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '删除失败')
      setPosts((current) => current.filter((item) => item.id !== post.id))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  return <section className="salon-mine-section"><nav className="salon-mine-tabs" aria-label="我的投稿状态">{[{ value: 'ALL' as const, label: '全部' }, ...SALON_POST_STATUSES.map((value) => ({ value, label: SALON_STATUS_LABELS[value] }))].map((tab) => <button key={tab.value} type="button" aria-pressed={filter === tab.value} onClick={() => setFilter(tab.value)}>{tab.label}<small>{tab.value === 'ALL' ? posts.length : posts.filter((post) => post.status === tab.value).length}</small></button>)}</nav>
    {!visiblePosts.length ? <div className="salon-empty salon-mine-empty"><strong>这里还没有投稿</strong><span>去上传一组照片，留下你的现场记录。</span><Link href="/salon/upload" className="salon-primary-button">开始投稿</Link></div> : <div className="salon-mine-list">{visiblePosts.map((post) => { const media = post.media[0]; const concert = post.concert; const context = concert ? ` · ${concert.tour.name} · ${concert.city}` : ' · 独立作品'; return <article key={post.id} className="salon-mine-card">{media ? <Link href={`/salon/${post.id}`} className="salon-mine-image"><img src={media.thumbnailUrl} alt={post.title || '沙龙作品'} /></Link> : null}<div className="salon-mine-card-body"><div className={`salon-status-badge salon-status-${post.status.toLowerCase()}`}>{SALON_STATUS_LABELS[post.status]}</div><h2>{post.title || '无标题作品'}</h2><p>{SALON_CATEGORY_LABELS[post.category]}{context}</p>{post.status === 'REJECTED' && post.rejectReason ? <div className="salon-reject-reason"><strong>原因：</strong>{post.rejectReason}</div> : null}<time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt))}</time><div className="salon-mine-actions"><Link href={`/salon/${post.id}`}>查看作品</Link><button type="button" onClick={() => void remove(post)} disabled={busyId === post.id}>{busyId === post.id ? '删除中…' : '删除作品'}</button></div></div></article> })}</div>}
  </section>
}
