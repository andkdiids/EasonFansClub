'use client'

/* 沙龙图片来自受控 COS URL；详情页沿用现有图片查看器的原生 img 语义。 */
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { SafeAvatar } from '@/components/SafeAvatar'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { formatUid } from '@/lib/uid'
import { formatSalonSession, SALON_CATEGORY_LABELS, SALON_STATUS_LABELS, type SalonCommentView, type SalonPostView } from '@/lib/salon'
import { SalonComments } from './SalonComments'
import { SalonLikeButton } from './SalonLikeButton'

export function SalonDetail({ post, initialComments, initialCommentsHasMore, initialCommentsNextCursor, currentUserId, canModerate }: Readonly<{
  post: SalonPostView
  initialComments: SalonCommentView[]
  initialCommentsHasMore: boolean
  initialCommentsNextCursor: string | null
  currentUserId: string | null
  canModerate: boolean
}>) {
  const router = useRouter()
  const [activeIndex, setActiveIndex] = useState(0)
  const activeMedia = post.media[activeIndex] || post.media[0]
  const gallery = post.media.map((media, index) => ({ id: media.id, src: media.originalUrl, previewSrc: media.previewUrl, alt: `${post.title || '沙龙作品'} · ${index + 1}` }))

  async function removePost() {
    if (!window.confirm('确定删除这篇沙龙作品吗？删除后无法恢复。')) return
    const response = await fetch(`/api/salon/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null) as { message?: string } | null
    if (!response.ok) { window.alert(data?.message || '删除失败，请稍后重试'); return }
    router.push(canModerate && currentUserId !== post.author.id ? '/salon' : '/salon/mine')
    router.refresh()
  }

  if (!activeMedia) return <main className="salon-page"><div className="salon-empty"><strong>作品图片暂时不可用</strong><Link href="/salon">返回沙龙</Link></div></main>

  return <main className="salon-page salon-detail-page">
    <div className="salon-page-back"><Link href="/salon">← 返回沙龙</Link><Link href="/salon/upload">上传照片</Link></div>
    {post.status !== 'APPROVED' ? <div className={`salon-review-banner salon-review-${post.status.toLowerCase()}`}><strong>{SALON_STATUS_LABELS[post.status]}</strong><span>{post.status === 'PENDING' ? '这篇作品正在等待管理员审核，暂不会出现在公开图库。' : `原因：${post.rejectReason || '请根据审核意见修改后重新投稿。'}`}</span></div> : null}
    <section className="salon-detail-layout">
      <div className="salon-detail-gallery">
        <ImageViewer key={activeMedia.id} src={activeMedia.originalUrl} previewSrc={activeMedia.previewUrl} alt={post.title || '沙龙作品'} gallery={gallery} initialIndex={activeIndex} imageClassName="salon-detail-main-image" buttonClassName="salon-detail-viewer-button" loading="eager" fetchPriority="high" />
        {post.media.length > 1 ? <div className="salon-detail-thumbnails" aria-label={`图片缩略图，共 ${post.media.length} 张`}>{post.media.map((media, index) => <button key={media.id} type="button" className={index === activeIndex ? 'is-active' : ''} onClick={() => setActiveIndex(index)} aria-label={`查看第 ${index + 1} 张图片`}><img src={media.thumbnailUrl} alt="" /></button>)}</div> : null}
        <p className="salon-image-note">原图尺寸：{activeMedia.width} × {activeMedia.height} · 点击图片可放大查看</p>
      </div>
      <aside className="salon-detail-info">
        <div className="salon-detail-author"><Link href={`/user/${formatUid(post.author.uid)}`}><SafeAvatar src={post.author.avatarUrl} name={post.author.nickname} uid={post.author.uid} className="salon-detail-avatar" textClassName="salon-avatar-fallback" /></Link><div><Link href={`/user/${formatUid(post.author.uid)}`} className="salon-detail-author-name">{post.author.nickname}</Link><span>发布于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(post.createdAt))}</span></div></div>
        <div className="salon-detail-tags"><span>{SALON_CATEGORY_LABELS[post.category]}</span><span>{post.concert.tour.name}</span></div>
        <h1>{post.title || '无标题作品'}</h1>
        <Link href={buildConcertSlugPath(post.concert.tour.name, post.concert.city, post.concert.date, post.concert.stageType)} className="salon-detail-concert">{formatSalonSession({ city: post.concert.city, concertDate: post.concert.date, venue: post.concert.venue, title: post.concert.title, sessionNumber: null })}</Link>
        {post.content ? <p className="salon-detail-content">{post.content}</p> : null}
        <div className="salon-detail-actions"><SalonLikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} /><span>评论 {post.commentCount}</span>{currentUserId === post.author.id || canModerate ? <button type="button" onClick={() => void removePost()} className="salon-danger-button">删除作品</button> : null}</div>
      </aside>
    </section>
    <SalonComments postId={post.id} initialComments={initialComments} initialCommentCount={post.commentCount} initialHasMore={initialCommentsHasMore} initialNextCursor={initialCommentsNextCursor} currentUserId={currentUserId} canModerate={canModerate} />
  </main>
}
