'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ImageViewer, type ImageViewerItem } from '@/components/ImageViewer'
import { FavoriteButton, LikeButton } from '@/components/PostActions'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'
import type { ForumDiscoveryMedia, ForumDiscoveryPost, ForumDiscoverySticker } from '@/lib/forum-discovery'

export type FishModeMediaSource = {
  id: string
  contentImages?: readonly string[]
  media?: readonly ForumDiscoveryMedia[]
  sticker?: ForumDiscoverySticker | null
}

type FishModeMediaEntry = {
  id: string
  type: 'IMAGE' | 'GIF' | 'VIDEO'
  url: string
  thumbnail: string | null
  width: number | null
  height: number | null
}

function isGifUrl(value: string | null | undefined) {
  return typeof value === 'string' && /\.gif(?:[?#]|$)/i.test(value)
}

function buildMediaEntries(source: FishModeMediaSource): FishModeMediaEntry[] {
  const entries: FishModeMediaEntry[] = []
  const seenUrls = new Set<string>()
  const push = (entry: FishModeMediaEntry) => {
    if (!entry.url || seenUrls.has(entry.url)) return
    seenUrls.add(entry.url)
    entries.push(entry)
  }

  source.contentImages?.forEach((url, index) => {
    push({
      id: `${source.id}-content-image-${index}`,
      type: isGifUrl(url) ? 'GIF' : 'IMAGE',
      url,
      thumbnail: publicImageVariantUrl(url, 'card') || url,
      width: null,
      height: null,
    })
  })
  source.media?.forEach((media) => {
    push({
      id: media.id,
      type: media.type === 'VIDEO' ? 'VIDEO' : isGifUrl(media.url) ? 'GIF' : 'IMAGE',
      url: media.url,
      thumbnail: media.thumbnail || publicImageVariantUrl(media.url, 'card') || media.url,
      width: media.width,
      height: media.height,
    })
  })
  if (source.sticker) {
    push({
      id: `${source.id}-sticker`,
      type: source.sticker.type === 'GIF' || isGifUrl(source.sticker.url) ? 'GIF' : 'IMAGE',
      url: source.sticker.url,
      thumbnail: publicImageVariantUrl(source.sticker.url, 'card') || source.sticker.url,
      width: null,
      height: null,
    })
  }
  return entries
}

export function getFishModeMediaSummary(source: FishModeMediaSource) {
  return buildMediaEntries(source).reduce((summary, item) => {
    if (item.type === 'VIDEO') summary.videoCount += 1
    else if (item.type === 'GIF') summary.gifCount += 1
    else summary.imageCount += 1
    return summary
  }, { imageCount: 0, gifCount: 0, videoCount: 0 })
}

function formatFishTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function FishModeImageGrid({ items }: Readonly<{ items: FishModeMediaEntry[] }>) {
  const gallery: ImageViewerItem[] = useMemo(() => items.map((item) => ({
    id: item.id,
    src: item.url,
    previewSrc: item.thumbnail || undefined,
    alt: '帖子图片',
  })), [items])

  return (
    <div className="fish-mode-image-grid">
      {items.map((item, index) => (
        <ImageViewer
          key={item.id}
          src={item.url}
          previewSrc={item.thumbnail || undefined}
          alt="帖子图片"
          gallery={gallery}
          initialIndex={index}
          autoPlay={false}
          loading="lazy"
          imageClassName="fish-mode-image"
          buttonClassName="fish-mode-image-trigger"
        />
      ))}
    </div>
  )
}

export function FishModeMediaDisclosure({ source, minimal = false }: Readonly<{ source: FishModeMediaSource; minimal?: boolean }>) {
  const [expanded, setExpanded] = useState(false)
  const [activeGifId, setActiveGifId] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const items = useMemo(() => buildMediaEntries(source), [source])
  const summary = useMemo(() => getFishModeMediaSummary(source), [source])
  const imageItems = items.filter((item) => item.type === 'IMAGE')
  const gifItems = items.filter((item) => item.type === 'GIF')
  const videoItems = items.filter((item) => item.type === 'VIDEO')

  useEffect(() => {
    setExpanded(false)
    setActiveGifId(null)
    setActiveVideoId(null)
  }, [source.id])

  if (!items.length) return null

  return (
    <div className={`fish-mode-media-disclosure${minimal ? ' is-minimal' : ''}`}>
      <div className="fish-mode-media-summary" aria-label="帖子媒体">
        <button type="button" className="fish-mode-media-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {summary.imageCount > 0 ? <span>▣ {summary.imageCount} 张图片</span> : null}
          {summary.imageCount > 0 && (summary.gifCount > 0 || summary.videoCount > 0) ? <span aria-hidden="true"> · </span> : null}
          {summary.gifCount > 0 ? <span>GIF {summary.gifCount}</span> : null}
          {summary.gifCount > 0 && summary.videoCount > 0 ? <span aria-hidden="true"> · </span> : null}
          {summary.videoCount > 0 ? <span>视频 {summary.videoCount}</span> : null}
        </button>
      </div>
      {expanded ? (
        <div className="fish-mode-media-panel">
          {imageItems.length ? <FishModeImageGrid items={imageItems} /> : null}
          {gifItems.length ? (
            <div className="fish-mode-gif-list">
              {gifItems.map((item, index) => activeGifId === item.id ? (
                <figure key={item.id} className="fish-mode-gif-item">
                  <figcaption>GIF {index + 1}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="帖子 GIF" loading="lazy" className="fish-mode-gif-image" />
                </figure>
              ) : (
                <button key={item.id} type="button" className="fish-mode-gif-placeholder" onClick={() => setActiveGifId(item.id)}>
                  GIF {index + 1}
                </button>
              ))}
            </div>
          ) : null}
          {videoItems.length ? (
            <div className="fish-mode-video-list">
              {videoItems.map((item, index) => activeVideoId === item.id ? (
                <figure key={item.id} className="fish-mode-video-item">
                  <figcaption>视频 {index + 1}</figcaption>
                  <video controls preload="metadata" poster={item.thumbnail || undefined} src={item.url} className="fish-mode-video" />
                </figure>
              ) : (
                <button key={item.id} type="button" className="fish-mode-video-placeholder" onClick={() => setActiveVideoId(item.id)}>
                  视频 {index + 1}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="fish-mode-media-collapse" onClick={() => setExpanded(false)}>收起媒体</button>
        </div>
      ) : null}
    </div>
  )
}

function postMediaSource(post: ForumDiscoveryPost): FishModeMediaSource {
  return {
    id: post.id,
    contentImages: post.contentImages || [],
    media: post.media || [],
    sticker: post.sticker || null,
  }
}

export function ForumFishModePostRow({ post, minimal = false, active = false, onOpen }: Readonly<{
  post: ForumDiscoveryPost
  minimal?: boolean
  active?: boolean
  onOpen: (postId: string) => void
}>) {
  const authorName = post.author.displayName || post.author.nickname
  const openPost = () => onOpen(post.id)
  const onContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openPost()
  }

  return (
    <article className="fish-mode-post-row" data-fish-mode-post-row data-post-id={post.id} data-active={active ? 'true' : 'false'}>
      <div className="fish-mode-post-meta">
        <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString('zh-CN')}>{formatFishTime(post.createdAt)}</time>
        <Link href={`/user/${formatUid(post.author.uid)}`} className="fish-mode-author-link">
          <span className="fish-mode-avatar" aria-hidden="true">
            <SafeAvatar src={post.author.avatarUrl} name={authorName} uid={post.author.uid} variant="avatar-sm" className="fish-mode-avatar-image" textClassName="fish-mode-avatar-fallback" />
          </span>
          <UserDisplayName name={authorName} uid={post.author.uid} badge={post.author.equippedBadge} badgeInteraction="static" compact />
        </Link>
        <span className="fish-mode-uid">· UID {formatUid(post.author.uid)}</span>
        {post.board.name && !minimal ? <span className="fish-mode-board">· {post.board.name}</span> : null}
        {post.isPinned ? <span className="fish-mode-post-flag">置顶</span> : null}
        {post.isFeatured ? <span className="fish-mode-post-flag">精华</span> : null}
      </div>

      <div className="fish-mode-post-content" role="button" tabIndex={0} onClick={openPost} onKeyDown={onContentKeyDown}>
        {(post.title || '').trim() ? <h2>{post.title}</h2> : null}
        {(post.contentPreview || '').trim() ? <p>{post.contentPreview}</p> : null}
      </div>

      <FishModeMediaDisclosure source={postMediaSource(post)} minimal={minimal} />

      <footer className="fish-mode-post-footer">
        <span className="fish-mode-post-stat">评论 {post.replyCount}</span>
        <LikeButton
          postId={post.id}
          initialLiked={post.likedByMe}
          initialCount={post.likeCount}
          refreshOnSuccess={false}
          className="fish-mode-like-button"
        />
        <FavoriteButton
          postId={post.id}
          initialFavorited={post.favoritedByMe}
          initialCount={post.favoriteCount}
          refreshOnSuccess={false}
          className="fish-mode-favorite-button"
        />
        <button type="button" className="fish-mode-preview-button" onClick={openPost}>打开预览</button>
      </footer>
    </article>
  )
}
