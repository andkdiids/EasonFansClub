'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { ProfileBackgroundLikeSummary, ProfileBackgroundLikerItem } from '@/lib/profile-background-likes'

type LikerPage = {
  ok: boolean
  items?: ProfileBackgroundLikerItem[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasMore: boolean
  }
  message?: string
}

type LikeMutation = Partial<ProfileBackgroundLikeSummary> & {
  ok?: boolean
  liked?: boolean
  message?: string
  code?: string
}

export function ProfileBackgroundLikeControl({
  profileOwnerId,
  isSelf,
  hasViewer,
  canInteract,
  initialSummary,
  initialListOpen = false,
}: {
  profileOwnerId: string
  isSelf: boolean
  hasViewer: boolean
  canInteract: boolean
  initialSummary: ProfileBackgroundLikeSummary
  initialListOpen?: boolean
}) {
  const [liked, setLiked] = useState(initialSummary.hasLikedBackground)
  const [count, setCount] = useState(initialSummary.backgroundLikeCount)
  const [todayUsed, setTodayUsed] = useState(initialSummary.todayBackgroundLikeUsed)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [listOpen, setListOpen] = useState(initialListOpen)
  const [listItems, setListItems] = useState<ProfileBackgroundLikerItem[]>([])
  const [listPage, setListPage] = useState(0)
  const [listHasMore, setListHasMore] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [mounted, setMounted] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const loadRequestRef = useRef(0)

  useEffect(() => setMounted(true), [])

  const loadLikers = useCallback(async (page: number, append = false) => {
    const requestId = ++loadRequestRef.current
    setListLoading(true)
    setListError('')
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(profileOwnerId)}/profile-background-like/likers?page=${page}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const data = await response.json().catch(() => null) as LikerPage | null
      if (!response.ok || !data?.ok || !data.items || !data.pagination) {
        throw new Error(data?.message || '暂时无法加载点赞用户')
      }
      if (requestId !== loadRequestRef.current) return
      setListItems((current) => append ? [...current, ...data.items!] : data.items!)
      setListPage(data.pagination.page)
      setListHasMore(data.pagination.hasMore)
      setCount(data.pagination.total)
    } catch (error) {
      if (requestId === loadRequestRef.current) setListError(error instanceof Error ? error.message : '暂时无法加载点赞用户')
    } finally {
      if (requestId === loadRequestRef.current) setListLoading(false)
    }
  }, [profileOwnerId])

  useEffect(() => {
    if (!listOpen) return
    setListItems([])
    setListPage(0)
    setListHasMore(false)
    void loadLikers(1)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setListOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [listOpen, loadLikers])

  async function updateLike(nextLiked: boolean) {
    if (busy || !canInteract || isSelf || !hasViewer) return
    const previousLiked = liked
    const previousCount = count
    setBusy(true)
    setMessage('')
    setLiked(nextLiked)
    setCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)))
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(profileOwnerId)}/profile-background-like`, {
        method: nextLiked ? 'POST' : 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json().catch(() => null) as LikeMutation | null
      if (!response.ok || !data?.ok) throw new Error(data?.message || '点赞操作暂时失败，请稍后重试')
      setLiked(Boolean(data.liked))
      if (typeof data.backgroundLikeCount === 'number') setCount(data.backgroundLikeCount)
      if (typeof data.todayBackgroundLikeUsed === 'number') setTodayUsed(data.todayBackgroundLikeUsed)
      if (listOpen) void loadLikers(1)
    } catch (error) {
      setLiked(previousLiked)
      setCount(previousCount)
      setMessage(error instanceof Error ? error.message : '点赞操作暂时失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const canToggle = hasViewer && canInteract && !isSelf
  const title = isSelf
    ? `主页背景累计获赞 ${count} 次，点击查看点赞用户`
    : canToggle
      ? `${liked ? '取消主页背景点赞' : '点赞主页背景'}；今日已为 ${todayUsed}/${initialSummary.dailyBackgroundLikeLimit} 位用户点过赞`
      : `主页背景累计获赞 ${count} 次，点击查看点赞用户`

  const modal = listOpen && mounted && typeof document !== 'undefined'
    ? createPortal(
        <div className="profile-background-likers-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setListOpen(false) }}>
          <section className="profile-background-likers-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-background-likers-title">
            <header className="profile-background-likers-header">
              <div>
                <p className="profile-background-likers-kicker">PERSONAL PAGE</p>
                <h2 id="profile-background-likers-title">主页背景获赞</h2>
              </div>
              <button ref={closeButtonRef} type="button" className="profile-background-likers-close" onClick={() => setListOpen(false)} aria-label="关闭点赞用户列表">×</button>
            </header>
            <div className="profile-background-likers-body">
              {!listLoading && !listItems.length && !listError ? <p className="profile-background-likers-empty">还没有人赞过这张主页背景。</p> : null}
              {listItems.map((item) => (
                <article key={item.id} className="profile-background-liker-row">
                  <Link href={item.profileUrl} className="profile-background-liker-avatar" onClick={() => setListOpen(false)} aria-label={`打开 ${item.displayName} 的个人主页`}>
                    {/* Public avatars are already normalized through the project's image proxy helper. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span>{item.displayName.slice(0, 1) || '?'}</span>}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <UserDisplayName
                      name={item.displayName}
                      uid={item.uid}
                      href={item.profileUrl}
                      badges={item.equippedBadges}
                      badge={item.equippedBadge}
                      compact
                      maxDisplay={2}
                      className="min-w-0"
                    />
                    <p>最近点赞</p>
                  </div>
                  <Link href={item.profileUrl} className="profile-background-liker-open" onClick={() => setListOpen(false)}>主页</Link>
                </article>
              ))}
              {listError ? <p className="profile-background-likers-error" role="alert">{listError}</p> : null}
              {listLoading ? <p className="profile-background-likers-loading" aria-live="polite">正在加载…</p> : null}
              {!listLoading && listHasMore ? (
                <button type="button" className="profile-background-likers-more" onClick={() => void loadLikers(listPage + 1, true)}>加载更多</button>
              ) : null}
            </div>
          </section>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <div className="profile-background-like-wrap">
        {canToggle ? (
          <button
            type="button"
            className={`profile-background-like-heart ${liked ? 'is-liked' : ''}`}
            disabled={busy}
            aria-pressed={liked}
            aria-label={liked ? '取消主页背景点赞' : '点赞主页背景'}
            title={title}
            onClick={() => void updateLike(!liked)}
          >
            <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
          </button>
        ) : (
          <button
            type="button"
            className="profile-background-like-heart is-readonly"
            onClick={() => setListOpen(true)}
            title={title}
            aria-label={`查看主页背景的 ${count} 位点赞用户`}
          >
            <span aria-hidden="true">♥</span>
          </button>
        )}
        <button type="button" className="profile-background-like-count" onClick={() => setListOpen(true)} title={title} aria-label={`查看主页背景的 ${count} 位点赞用户`}>
          {count}
        </button>
        {busy ? <span className="profile-background-like-busy" aria-live="polite">处理中</span> : null}
      </div>
      {message ? <p className="profile-background-like-message" role="alert">{message}</p> : null}
      {modal}
    </>
  )
}
