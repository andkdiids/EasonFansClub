'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LikeButton } from '@/components/PostActions'
import { IpRegionLabel } from '@/components/IpRegionLabel'
import { getForumDiscoveryCoverFit, type ForumDiscoveryPost } from '@/lib/forum-discovery'

function DiscoveryCover({ post, priority }: Readonly<{ post: ForumDiscoveryPost; priority: boolean }>) {
  const [fit, setFit] = useState<'cover' | 'contain'>(getForumDiscoveryCoverFit(post.cover?.width, post.cover?.height))
  const [failed, setFailed] = useState(false)
  const cover = post.cover

  if (!cover || failed) {
    return (
      <div className="forum-discovery-cover forum-discovery-text-cover" aria-label="文字封面">
        <span className={`forum-discovery-text-cover-title forum-discovery-text-cover-title-${post.title.length > 34 ? 'small' : post.title.length > 18 ? 'medium' : 'large'}`}>
          {post.title}
        </span>
      </div>
    )
  }

  return (
    <div className="forum-discovery-cover">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cover.url}
        alt=""
        className={`forum-discovery-cover-image is-${fit}`}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={(event) => setFit(getForumDiscoveryCoverFit(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function ForumDiscoveryCard({ post, priority = false, onOpen }: Readonly<{
  post: ForumDiscoveryPost
  priority?: boolean
  onOpen: (postId: string) => void
}>) {
  return (
    <article className="forum-discovery-card">
      <Link href={`/posts/${post.id}`} className="forum-discovery-card-link" onClick={(event) => { event.preventDefault(); onOpen(post.id) }}>
        <DiscoveryCover post={post} priority={priority} />
        <div className="forum-discovery-card-body">
          <div className="forum-discovery-card-badges" aria-label="帖子标签">
            {post.isPinned ? <span>置顶</span> : null}
            {post.isFeatured ? <span>精华</span> : null}
            {post.board.name ? <span>{post.board.name}</span> : null}
          </div>
          <h2>{post.title}</h2>
        </div>
      </Link>
      <div className="forum-discovery-card-meta">
        <div className="forum-discovery-author">
          <span className="forum-discovery-avatar">
            {post.author.avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={post.author.avatarUrl} alt="" loading="lazy" />
            ) : post.author.displayName.slice(0, 1)}
          </span>
          <span title={post.author.displayName}>{post.author.displayName}</span>
          <IpRegionLabel ipRegion={post.ipRegion} />
        </div>
        <LikeButton
          postId={post.id}
          initialLiked={post.likedByMe}
          initialCount={post.likeCount}
          refreshOnSuccess={false}
          className="forum-discovery-like-button"
        />
      </div>
    </article>
  )
}
