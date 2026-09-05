'use client'

import { Fragment, useEffect, useRef, useState, type UIEvent } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import { getFriendDisplayName } from '@/lib/friend-display-name'
import { getLikeAvatarPreview, mergeLikeAvatarUsers } from '@/lib/like-avatar-utils'

/**
 * 点赞用户数据结构（各内容类型点赞关系联查 User 后的统一视图）。
 * 主帖的头像模式只需要 id、uid 和 avatarUrl；其他复用场景仍可携带旧的
 * displayName / equippedBadge 字段，保持它们原有的展示契约。
 */
export type LikeAvatarUser = {
  id: string
  uid: number
  avatarUrl: string | null
  nickname?: string
  friendRemark?: string | null
  displayName?: string
  equippedBadges?: EquippedBadgeView[]
  equippedBadge?: EquippedBadgeView | null
}

export type LikeAvatarIdentity = {
  id: string
  uid: number
  avatarUrl?: string | null
}

const MAX_INLINE_AVATARS = 10
const MOBILE_INLINE_AVATARS = 7

type LikeInteractionDetail = {
  postId?: string
  isLiked?: boolean
  likeCount?: number
  liker?: LikeAvatarIdentity | null
}

function likerDisplayName(liker: LikeAvatarUser) {
  return getFriendDisplayName({
    nickname: liker.nickname || liker.displayName || 'E院用户',
    friendRemark: liker.friendRemark || null,
    isFriendContext: Boolean(liker.friendRemark),
  })
}

function normalizeLiker(identity: LikeAvatarIdentity): LikeAvatarUser {
  return {
    id: identity.id,
    uid: identity.uid,
    avatarUrl: identity.avatarUrl || null,
  }
}

function prependLiker(likers: LikeAvatarUser[], identity: LikeAvatarIdentity) {
  const liker = normalizeLiker(identity)
  return [liker, ...likers.filter((item) => item.id !== liker.id)]
}

function LikerAvatar({
  liker,
  avatarOnly,
  size,
  link = true,
}: Readonly<{
  liker: LikeAvatarUser
  avatarOnly: boolean
  size: 'preview' | 'expanded'
  link?: boolean
}>) {
  const avatar = (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white ${size === 'expanded' && avatarOnly ? 'h-8 w-8' : avatarOnly ? 'h-7 w-7' : size === 'expanded' ? 'h-5 w-5' : 'h-6 w-6'}`}>
      <SafeAvatar
        src={profileImageUrl(liker.avatarUrl)}
        name={avatarOnly ? '点赞用户头像' : likerDisplayName(liker)}
        uid={liker.uid}
        className="h-full w-full"
        textClassName={size === 'expanded' && avatarOnly ? 'text-xs' : 'text-[10px]'}
      />
    </span>
  )

  if (!link || liker.uid <= 0) return avatar

  return (
    <a
      href={`/user/${formatUid(liker.uid)}`}
      onClick={(event) => event.stopPropagation()}
      aria-label={avatarOnly ? '查看点赞用户资料' : `查看 ${likerDisplayName(liker)} 的主页`}
      className="shrink-0"
    >
      {avatar}
    </a>
  )
}

/**
 * 朋友圈式点赞头像行。主帖可通过 avatarOnly 开启纯头像模式：首屏按响应式宽度
 * 展示头像，展开后按 listUrl 的 nextCursor 逐页加载，滚动到底部继续读取。
 * 其他复用场景保留原有头像 + 用户名 + 勋章展示。
 */
export function LikeAvatars({
  likers,
  totalCount,
  listUrl,
  className = '',
  avatarOnly = false,
  postId,
  responsivePreview = false,
  currentUser = null,
}: Readonly<{
  likers: LikeAvatarUser[]
  totalCount: number
  listUrl?: string
  className?: string
  avatarOnly?: boolean
  postId?: string
  responsivePreview?: boolean
  currentUser?: LikeAvatarIdentity | null
}>) {
  const safeInitialCount = Math.max(0, totalCount, likers.length)
  const [expanded, setExpanded] = useState(false)
  const [liveLikers, setLiveLikers] = useState<LikeAvatarUser[]>(likers)
  const [liveTotalCount, setLiveTotalCount] = useState(safeInitialCount)
  const [fullLikers, setFullLikers] = useState<LikeAvatarUser[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [previewLimit, setPreviewLimit] = useState(MAX_INLINE_AVATARS)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const loadingRef = useRef(false)

  useEffect(() => {
    if (fullLikers) return
    setLiveLikers(likers)
    setLiveTotalCount(safeInitialCount)
  }, [fullLikers, likers, safeInitialCount])

  useEffect(() => {
    if (!responsivePreview) return
    const media = window.matchMedia('(max-width: 639px)')
    const sync = () => setPreviewLimit(media.matches ? MOBILE_INLINE_AVATARS : MAX_INLINE_AVATARS)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [responsivePreview])

  useEffect(() => {
    if (!postId) return
    const syncLike = (event: Event) => {
      const detail = (event as CustomEvent<LikeInteractionDetail>).detail
      if (detail?.postId !== postId || typeof detail.isLiked !== 'boolean') return
      if (typeof detail.likeCount === 'number') setLiveTotalCount(Math.max(detail.likeCount, 0))
      const liker = detail.liker || currentUser
      if (!liker) return
      if (detail.isLiked) {
        setLiveLikers((current) => prependLiker(current, liker))
        setFullLikers((current) => current ? prependLiker(current, liker) : current)
      } else {
        setLiveLikers((current) => current.filter((item) => item.id !== liker.id))
        setFullLikers((current) => current ? current.filter((item) => item.id !== liker.id) : current)
      }
    }
    window.addEventListener('ecfc:post-interaction', syncLike)
    return () => window.removeEventListener('ecfc:post-interaction', syncLike)
  }, [currentUser, postId])

  async function loadLikersPage(cursor: string | null) {
    if (!listUrl || loadingRef.current) return
    loadingRef.current = true
    setIsLoading(true)
    setLoadError('')
    try {
      const url = cursor
        ? `${listUrl}${listUrl.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
        : listUrl
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as {
        likers?: LikeAvatarUser[]
        total?: number
        nextCursor?: string | null
      }
      if (!response.ok || !Array.isArray(data.likers)) throw new Error('load failed')
      setLiveLikers((current) => mergeLikeAvatarUsers(current, data.likers || []))
      setFullLikers((current) => mergeLikeAvatarUsers(current || [], data.likers || []))
      if (typeof data.total === 'number' && Number.isFinite(data.total)) setLiveTotalCount(Math.max(0, data.total))
      setNextCursor(typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null)
    } catch {
      setLoadError('点赞列表加载失败，请稍后重试')
    } finally {
      loadingRef.current = false
      setIsLoading(false)
    }
  }

  function toggleExpanded() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (fullLikers) return
    if (listUrl) {
      void loadLikersPage(null)
    } else {
      setFullLikers(liveLikers)
    }
  }

  function handleListScroll(event: UIEvent<HTMLDivElement>) {
    if (isLoading || !listUrl) return
    const distanceToBottom = event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight
    if (distanceToBottom > 80) return
    if (fullLikers === null) {
      void loadLikersPage(null)
    } else if (nextCursor) {
      void loadLikersPage(nextCursor)
    }
  }

  const displayLikers = fullLikers || liveLikers
  const displayTotalCount = Math.max(liveTotalCount, displayLikers.length)
  if (displayTotalCount <= 0 && displayLikers.length === 0) return null

  const { visible: inlineLikers, overflow } = getLikeAvatarPreview(displayLikers, displayTotalCount, previewLimit)

  return (
    <div className={className}>
      <div className="flex max-w-full flex-wrap items-center gap-x-1 gap-y-1">
        <span className="text-xs text-red-500" aria-hidden>❤</span>
        {inlineLikers.map((liker, index) => (
          <Fragment key={liker.id}>
            <LikerAvatar liker={liker} avatarOnly={avatarOnly} size="preview" />
            {index < inlineLikers.length - 1 || overflow > 0 ? <span className="px-0.5 text-sm font-bold leading-none text-slate-400" aria-hidden>、</span> : null}
          </Fragment>
        ))}
        {overflow > 0 ? (
          <button type="button" onClick={toggleExpanded} aria-expanded={expanded} aria-label={`查看全部 ${displayTotalCount} 个点赞`} className="px-0.5 text-xs font-black text-slate-400">
            +{overflow}
          </button>
        ) : null}
        <button type="button" onClick={toggleExpanded} aria-expanded={expanded} aria-label={`查看全部 ${displayTotalCount} 个点赞`} className="ml-0.5 min-h-8 px-1 text-left text-xs font-bold text-slate-400">
          {displayTotalCount} 人赞过 {expanded ? '↑' : '↓'}
        </button>
      </div>
      {expanded ? (
        <div className="mt-1.5 rounded-sm border border-sky-100 bg-white p-2">
          {loadError ? (
            <div className="flex flex-wrap items-center gap-2 px-1 py-1">
              <p className="text-xs font-bold text-red-600">{loadError}</p>
              <button type="button" onClick={() => void loadLikersPage(fullLikers ? nextCursor : null)} className="text-xs font-black text-brand-700">重试</button>
            </div>
          ) : null}
          <div
            className={avatarOnly ? 'max-h-[min(50dvh,420px)] max-w-full overflow-y-auto overscroll-contain' : ''}
            onScroll={avatarOnly ? handleListScroll : undefined}
            data-like-avatar-list={avatarOnly ? 'avatars-only' : 'legacy'}
          >
            {avatarOnly ? (
              <ul className="flex max-w-full flex-wrap items-center gap-x-1 gap-y-1.5" aria-label="点赞用户头像列表">
                {displayLikers.map((liker, index) => (
                  <li key={liker.id} className="flex min-w-0 items-center">
                    <LikerAvatar liker={liker} avatarOnly size="expanded" />
                    {index < displayLikers.length - 1 ? <span className="px-0.5 text-sm font-bold leading-none text-slate-400" aria-hidden>、</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                {displayLikers.map((liker) => (
                  <li key={liker.id}>
                    <a
                      href={`/user/${formatUid(liker.uid)}`}
                      onClick={(event) => event.stopPropagation()}
                      className="flex items-center gap-1.5 text-xs font-black text-brand-700 hover:text-brand-950"
                    >
                      <LikerAvatar liker={liker} avatarOnly={false} size="expanded" link={false} />
                      <UserDisplayName name={likerDisplayName(liker)} uid={liker.uid} badges={liker.equippedBadges} badge={liker.equippedBadge} compact />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {avatarOnly && !isLoading && !loadError && nextCursor ? (
              <button
                type="button"
                onClick={() => void loadLikersPage(nextCursor)}
                className="mt-2 min-h-8 px-1 text-xs font-black text-brand-700"
                data-like-avatar-load-more="true"
              >
                加载更多点赞用户
              </button>
            ) : null}
            {avatarOnly && isLoading ? <p className="px-1 py-1 text-xs font-bold text-slate-400">加载中…</p> : null}
            {avatarOnly && !isLoading && !loadError && !displayLikers.length ? <p className="px-1 py-1 text-xs font-bold text-slate-400">暂无点赞用户</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
