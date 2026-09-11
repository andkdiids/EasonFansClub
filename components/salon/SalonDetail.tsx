'use client'

/* 沙龙图片来自受控 COS URL；详情页沿用现有图片查看器的原生 img 语义。 */
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type MouseEvent } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { SafeAvatar } from '@/components/SafeAvatar'
import { ShareButton } from '@/components/share/ShareButton'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { formatUid } from '@/lib/uid'
import { formatSalonPostContext, formatSalonSession, getSalonPostDisplayTitle, SALON_CATEGORY_CONFIG, SALON_STATUS_LABELS, type SalonCommentView, type SalonPostView, supportsOriginal } from '@/lib/salon-shared'
import { canonicalShareUrl, type ShareCardData } from '@/lib/share-card'
import { shareCardImageCandidates } from '@/lib/share-metadata'
import { SalonComments } from './SalonComments'
import { SalonLikeButton } from './SalonLikeButton'
import { SalonViewCounter } from './SalonViewCounter'
import { appendSalonListRestoreParam, updateSalonListHistoryState } from '@/lib/salon-scroll-state'

export function SalonDetail({ post, initialComments, initialCommentsHasMore, initialCommentsNextCursor, currentUserId, canModerate, returnHref = null }: Readonly<{
  post: SalonPostView
  initialComments: SalonCommentView[]
  initialCommentsHasMore: boolean
  initialCommentsNextCursor: string | null
  currentUserId: string | null
  canModerate: boolean
  returnHref?: string | null
}>) {
  const router = useRouter()
  const [activeIndex, setActiveIndex] = useState(0)
  const activeMedia = post.media[activeIndex] || post.media[0]
  const displayTitle = getSalonPostDisplayTitle(post)
  const gallery = post.media.map((media, index) => ({ id: media.id, src: media.previewUrl, previewSrc: media.thumbnailUrl, originalUrl: null, downloadUrl: supportsOriginal(post.category) && media.originalAvailable ? `/api/salon/media/${encodeURIComponent(media.id)}/original?mode=download` : undefined, alt: `${displayTitle} · ${index + 1}` }))
  const concert = post.concert
  const categoryLabel = SALON_CATEGORY_CONFIG[post.category].label
  const metadata = formatSalonPostContext(post.category, concert)
  const shareCardImages = shareCardImageCandidates(post.media.map((media) => ({ url: media.previewUrl, width: media.width, height: media.height })))
  const shareCardData: ShareCardData = {
    type: 'salon',
    contentId: post.id,
    title: displayTitle,
    description: post.content || metadata,
    image: shareCardImages[0]?.url || null,
    imageWidth: shareCardImages[0]?.width,
    imageHeight: shareCardImages[0]?.height,
    imageCandidates: shareCardImages,
    url: canonicalShareUrl(`/salon/${post.id}`),
    author: post.author.nickname,
    authorAvatar: post.author.avatarUrl,
    date: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt)),
    meta: [{ label: '沙龙', value: categoryLabel }, ...(concert ? [{ label: '演唱会', value: concert.tour.name }, { label: '场次', value: formatSalonSession({ city: concert.city, concertDate: concert.date, venue: concert.venue, title: concert.title, sessionNumber: concert.sessionNumber }) }] : [])],
  }
  const returnLinkHref = returnHref ? appendSalonListRestoreParam(returnHref) : '/salon'

  useEffect(() => {
    // The list state belongs to the previous history entry. Clear any copied
    // state from the detail entry so a fresh /salon visit cannot restore it.
    window.history.replaceState(updateSalonListHistoryState(window.history.state, null), '', window.location.href)
  }, [])

  function handleReturnToSalon(event: MouseEvent<HTMLAnchorElement>) {
    if (!returnHref || window.history.length <= 1 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.back()
  }

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
    <div className="salon-page-back"><Link href={returnLinkHref} onClick={handleReturnToSalon}>← 返回沙龙</Link><ShareButton data={shareCardData} label="分享" triggerClassName="salon-share-button" ariaLabel="分享沙龙作品" /></div>
    {post.status !== 'APPROVED' ? <div className={`salon-review-banner salon-review-${post.status.toLowerCase()}`}><strong>{SALON_STATUS_LABELS[post.status]}</strong><span>{post.status === 'PENDING' ? '这篇作品正在等待管理员审核，暂不会出现在公开图库。' : `原因：${post.rejectReason || '请根据审核意见修改后重新投稿。'}`}</span></div> : null}
    <section className="salon-detail-layout">
      <div className="salon-detail-gallery">
        <ImageViewer key={activeMedia.id} src={activeMedia.previewUrl} previewSrc={activeMedia.thumbnailUrl} alt={displayTitle} gallery={gallery} initialIndex={activeIndex} imageClassName="salon-detail-main-image" buttonClassName="salon-detail-viewer-button" loading="eager" fetchPriority="high" />
        {post.media.length > 1 ? <div className="salon-detail-thumbnails" aria-label={`图片缩略图，共 ${post.media.length} 张`}>{post.media.map((media, index) => <button key={media.id} type="button" className={index === activeIndex ? 'is-active' : ''} onClick={() => setActiveIndex(index)} aria-label={`查看第 ${index + 1} 张图片`}><img src={media.thumbnailUrl} alt="" /></button>)}</div> : null}
        <p className="salon-image-note">图片尺寸：{activeMedia.width} × {activeMedia.height} · 点击图片可放大查看{supportsOriginal(post.category) && activeMedia.originalAvailable ? '，查看器内可下载原图' : ''}</p>
      </div>
      <aside className="salon-detail-info">
        <div className="salon-detail-author"><Link href={`/user/${formatUid(post.author.uid)}`}><SafeAvatar src={post.author.avatarUrl} name={post.author.nickname} uid={post.author.uid} className="salon-detail-avatar" textClassName="salon-avatar-fallback" /></Link><div><Link href={`/user/${formatUid(post.author.uid)}`} className="salon-detail-author-name">{post.author.nickname}</Link><span>发布于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(post.createdAt))}</span></div></div>
        <div className="salon-detail-tags"><span>{categoryLabel}</span>{concert ? <span>{concert.tour.name}</span> : null}</div>
        <h1>{displayTitle}</h1>
        {concert ? <Link href={buildConcertSlugPath(concert.tour.name, concert.city, concert.date, concert.stageType)} className="salon-detail-concert">{metadata}</Link> : <p className="salon-detail-concert">{metadata}</p>}
        {post.content ? <p className="salon-detail-content">{post.content}</p> : null}
        <div className="salon-detail-actions"><SalonLikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} /><span>评论 {post.commentCount}</span><SalonViewCounter postId={post.id} initialCount={post.viewCount} />{currentUserId === post.author.id || canModerate ? <button type="button" onClick={() => void removePost()} className="salon-danger-button">删除作品</button> : null}</div>
      </aside>
    </section>
    <SalonComments postId={post.id} initialComments={initialComments} initialCommentCount={post.commentCount} initialHasMore={initialCommentsHasMore} initialNextCursor={initialCommentsNextCursor} currentUserId={currentUserId} canModerate={canModerate} />
  </main>
}
