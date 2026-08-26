'use client'

import { useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import { getFriendDisplayName } from '@/lib/friend-display-name'

/**
 * 点赞用户数据结构（各内容类型点赞关系联查 User 后的统一视图）。
 * 头像跳转目标为公开个人病历页 /user/[uid]，隐私规则由该页自行保证。
 */
export type LikeAvatarUser = {
  id: string
  uid: number
  nickname: string
  friendRemark: string | null
  displayName: string
  avatarUrl: string | null
  equippedBadge: EquippedBadgeView | null
}

const MAX_INLINE_AVATARS = 10

function likerDisplayName(liker: LikeAvatarUser) {
  return getFriendDisplayName({
    nickname: liker.nickname || liker.displayName,
    friendRemark: liker.friendRemark,
    isFriendContext: Boolean(liker.friendRemark),
  })
}

/**
 * 朋友圈式点赞头像行：❤ + 最多 10 个点赞用户头像，超出显示 +N。
 * 点击展开完整点赞用户列表：已加载数据直接展示；若总数超过已加载数量且提供 listUrl，
 * 展开时懒加载一次完整列表（listUrl 应对应内容点赞路由的 GET，返回 { likers: LikeAvatarUser[] }）。
 */
export function LikeAvatars({
  likers,
  totalCount,
  listUrl,
  className = '',
}: Readonly<{
  likers: LikeAvatarUser[]
  totalCount: number
  listUrl?: string
  className?: string
}>) {
  const [expanded, setExpanded] = useState(false)
  const [fullLikers, setFullLikers] = useState<LikeAvatarUser[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  if (totalCount <= 0 && likers.length === 0) return null

  const inlineLikers = likers.slice(0, MAX_INLINE_AVATARS)
  const overflow = Math.max(totalCount - inlineLikers.length, 0)
  const displayLikers = fullLikers || likers

  async function toggleExpanded() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    // 展开时才拉取完整列表（只在总数超过已加载数量且未拉取过时请求一次）
    if (listUrl && totalCount > likers.length && !fullLikers && !isLoading) {
      setIsLoading(true)
      setLoadError('')
      try {
        const response = await fetch(listUrl, { headers: { Accept: 'application/json' } })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.likers)) throw new Error('load failed')
        setFullLikers(data.likers)
      } catch {
        setLoadError('点赞列表加载失败，请稍后重试')
      } finally {
        setIsLoading(false)
      }
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void toggleExpanded()
        }}
        aria-expanded={expanded}
        aria-label={`查看全部 ${totalCount} 个点赞`}
        className="flex flex-wrap items-center gap-1 text-left"
      >
        <span className="text-xs text-red-500" aria-hidden>❤</span>
        {inlineLikers.map((liker) => (
          <span key={liker.id} className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white">
            <SafeAvatar
              src={profileImageUrl(liker.avatarUrl)}
              name={likerDisplayName(liker)}
              uid={liker.uid}
              className="h-full w-full"
              textClassName="text-[10px]"
            />
          </span>
        ))}
        {overflow > 0 ? <span className="text-xs font-black text-slate-400">+{overflow}</span> : null}
        <span className="ml-0.5 text-xs font-bold text-slate-400">{totalCount} 人赞过{expanded ? ' ▴' : ' ▾'}</span>
      </button>
      {expanded ? (
        <div className="mt-1.5 rounded-sm border border-sky-100 bg-white p-2">
          {isLoading ? <p className="px-1 py-1 text-xs font-bold text-slate-400">加载中…</p> : null}
          {loadError ? <p className="px-1 py-1 text-xs font-bold text-red-600">{loadError}</p> : null}
          {!isLoading && !loadError ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
              {displayLikers.map((liker) => (
                <li key={liker.id}>
                  <a
                    href={`/user/${formatUid(liker.uid)}`}
                    onClick={(event) => event.stopPropagation()}
                    className="flex items-center gap-1.5 text-xs font-black text-brand-700 hover:text-brand-950"
                  >
                    <span className="grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-brand-950 text-[9px] font-black text-white">
                      <SafeAvatar
                        src={profileImageUrl(liker.avatarUrl)}
                        name={likerDisplayName(liker)}
                        uid={liker.uid}
                        className="h-full w-full"
                        textClassName="text-[9px]"
                      />
                    </span>
                    <UserDisplayName name={likerDisplayName(liker)} uid={liker.uid} badge={liker.equippedBadge} compact />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
