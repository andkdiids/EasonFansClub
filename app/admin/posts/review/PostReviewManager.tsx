'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { PostFeatureConfirmDialog } from '@/components/PostFeatureConfirmDialog'
import { notifyForumDiscoveryFeedChanged } from '@/lib/forum-discovery-session'
import { postModerationStatuses, type PostModerationStatus } from '@/lib/post-moderation'

export type ReviewPost = {
  id: string
  boardId: string
  title: string
  content: string
  createdAt: string
  moderationStatus: PostModerationStatus
  reviewedAt: string | null
  rejectionReason: string | null
  isPinned: boolean
  isFeatured: boolean
  User: { uid: number; nickname: string; role: string; Profile: { displayName: string | null } | null }
  ReviewedBy: { id: string; uid: number; name: string } | null
  PostModerationHistory: { id: string; actorName: string | null; actorUid: number | null; action: string; status: PostModerationStatus; titleSnapshot: string | null; rejectionReason: string | null; createdAt: string }[]
  Board: { name: string }
  PostMedia: { id: string; url: string | null; thumbnail: string | null }[]
}

/** 发布分区候选：来自广场/发帖系统真实分区数据源（页面服务端注入）。 */
export type ReviewBoardOption = { id: string; name: string; slug: string }

type ReviewStatus = ReviewPost['moderationStatus']
type ReviewFilter = ReviewStatus | 'ALL'
type ReviewTarget = {
  postId: string
  title: string
  nextStatus: Exclude<ReviewStatus, 'PENDING'>
}

const statusLabels: Record<ReviewFilter, string> = { ALL: '全部', PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝', VIOLATION: '违规内容' }
const reviewFilters: ReviewFilter[] = ['ALL', ...postModerationStatuses]

// 客户端纯函数（不依赖 prisma），用于加精权限判断。
function isSuperAdminRole(role?: string | null) {
  return role === 'SUPER_ADMIN'
}
// 帖子作者是否为受保护角色（管理员 / 版主 / 超级管理员）：这类帖子仅超级管理员可加精。
function isPrivilegedAuthorRole(role?: string | null) {
  return role === 'ADMIN' || role === 'MODERATOR' || role === 'SUPER_ADMIN'
}

export function PostReviewManager({ initialPosts, initialHasMore, boards, currentUserRole }: { initialPosts: ReviewPost[]; initialHasMore: boolean; boards: ReviewBoardOption[]; currentUserRole?: string | null }) {
  const [posts, setPosts] = useState(initialPosts)
  const [queueStatus, setQueueStatus] = useState<ReviewFilter>('PENDING')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  // 关键词搜索（标题 / 正文 / 作者昵称 / UID / 帖子 ID）
  const [keyword, setKeyword] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // 加精二次确认
  const [featureConfirm, setFeatureConfirm] = useState<{ postId: string; title: string; nextIsFeatured: boolean } | null>(null)
  const [flaggingId, setFlaggingId] = useState<string | null>(null)
  // 每张待审卡片的「发布分区」选择（未点通过前只存在于前端状态，绝不改动正式帖子）。
  const [publishBoardByPostId, setPublishBoardByPostId] = useState<Record<string, string>>({})

  // 进入页面或组件被 Next.js 客户端导航复用时，保证列表始终与当前选中 Tab 对齐：
  // 若服务端预取的初始列表与当前 queueStatus 不一致（例如复用上一轮 Tab 的列表数据），
  // 则按当前状态重新拉取，避免「待审核 Tab 却显示已通过列表」。正常首屏（初始列表已为
  // PENDING）不重复请求，兼顾无闪烁与数据正确性。
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      const mismatched = queueStatus !== 'ALL' && initialPosts.some((post) => post.moderationStatus !== queueStatus)
      if (!mismatched) return
    }
    void loadStatus(queueStatus, 1)
    // 仅在挂载时做一次一致性校验；queueStatus 变化由下方依赖触发刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueStatus])

  async function loadStatus(nextStatus: ReviewFilter, nextPage = 1) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ status: nextStatus, page: String(nextPage) })
      if (keyword.trim()) params.set('keyword', keyword.trim())
      const response = await fetch(`/api/admin/posts/review?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '列表加载失败')
        return
      }
      setPosts(Array.isArray(data?.posts) ? data.posts as ReviewPost[] : [])
      setPublishBoardByPostId({})
      setQueueStatus(nextStatus)
      setPage(typeof data?.page === 'number' && data.page > 0 ? data.page : nextPage)
      setHasMore(data?.hasMore === true)
    } catch {
      setError('列表加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function review(postId: string, status: Exclude<ReviewStatus, 'PENDING'>, reason: string | null = null, publishBoardId?: string) {
    setReviewingId(postId)
    setError('')
    try {
      const currentPost = posts.find((post) => post.id === postId)
      const boardChanged = status === 'APPROVED' && Boolean(publishBoardId) && currentPost && publishBoardId !== currentPost.boardId
      const response = await fetch('/api/admin/posts/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          status,
          rejectionReason: reason,
          ...(boardChanged ? { boardId: publishBoardId } : {}),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '审核失败')
        return
      }
      const nextBoardName = boardChanged && publishBoardId
        ? boards.find((board) => board.id === publishBoardId)?.name
        : undefined
      if (boardChanged && currentPost && publishBoardId) {
        // 审核通过并调整分区后，与发帖编辑改分区共用同一套前台 feed 缓存失效，
        // 旧分区/新分区/全部列表的快照立刻失效，避免返回旧分区列表仍显示旧帖。
        const slugOf = (id: string) => boards.find((board) => board.id === id)?.slug ?? null
        notifyForumDiscoveryFeedChanged({
          postId,
          boardFrom: slugOf(currentPost.boardId),
          boardTo: slugOf(publishBoardId),
        })
      }
      if (queueStatus === 'ALL') {
        setPosts((current) => current.map((post) => post.id === postId
          ? {
              ...post,
              moderationStatus: status,
              reviewedAt: typeof data?.post?.reviewedAt === 'string' ? data.post.reviewedAt : post.reviewedAt,
              rejectionReason: status === 'REJECTED' ? (data?.post?.rejectionReason || reason) : null,
              ...(boardChanged && publishBoardId && nextBoardName ? { boardId: publishBoardId, Board: { name: nextBoardName } } : {}),
            }
          : post))
      } else {
        setPosts((current) => current.filter((post) => post.id !== postId))
      }
      window.dispatchEvent(new Event('unread-summary:refresh'))
      setMessage(status === 'APPROVED'
        ? (boardChanged ? `帖子已通过审核，发布分区已调整为：${nextBoardName || publishBoardId || ''}` : '帖子已通过审核，并已进入已通过列表')
        : '帖子已拒绝，并已进入已拒绝列表')
    } catch {
      setError('审核失败，请稍后重试')
    } finally {
      setReviewingId(null)
    }
  }

  function requestReview(post: ReviewPost, nextStatus: Exclude<ReviewStatus, 'PENDING'>) {
    if (post.moderationStatus === nextStatus) return
    setError('')
    setMessage('')
    setRejectReason(nextStatus === 'REJECTED' ? post.rejectionReason || '' : '')
    setReviewTarget({ postId: post.id, title: post.title, nextStatus })
  }

  async function confirmReview() {
    if (!reviewTarget) return
    const reason = rejectReason.trim()
    if (reviewTarget.nextStatus === 'REJECTED' && !reason) {
      setError('拒绝帖子时必须填写拒绝理由')
      return
    }
    const target = reviewTarget
    setReviewTarget(null)
    // 发布分区只随「通过审核」提交；拒绝时忽略任何前端分区选择（服务端同样忽略）。
    const chosenBoardId = publishBoardByPostId[target.postId]
    await review(
      target.postId,
      target.nextStatus,
      target.nextStatus === 'REJECTED' ? reason || null : null,
      target.nextStatus === 'APPROVED' ? chosenBoardId : undefined,
    )
  }

  async function toggleFlag(postId: string, field: 'isPinned' | 'isFeatured', value: boolean) {
    if (flaggingId || reviewingId) return
    setError('')
    setFlaggingId(postId)
    try {
      const response = await fetch(`/api/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || '设置失败'); return }
      setPosts((current) => current.map((post) => post.id === postId ? { ...post, [field]: value } : post))
      if (field === 'isFeatured') setFeatureConfirm(null)
      setMessage(value ? '帖子标记已设置' : '帖子标记已取消')
    } catch {
      setError('设置失败，请稍后重试')
    } finally {
      setFlaggingId(null)
    }
  }

  function canFeaturePost(post: ReviewPost) {
    if (post.isFeatured) return false // 已加精不显示加精按钮
    // 受保护作者（管理员/版主）的帖子，仅超级管理员可加精
    if (isPrivilegedAuthorRole(post.User?.role) && !isSuperAdminRole(currentUserRole)) return false
    return true
  }

  function submitSearch() {
    setKeyword(searchInput.trim())
    void loadStatus(queueStatus, 1)
  }

  return <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7" aria-busy={loading || Boolean(reviewingId)}>
    {message ? <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}

    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Post Queue</p>
        <h2 className="mt-1 text-2xl font-black text-brand-950">{queueStatus === 'ALL' ? '全部帖子' : `${statusLabels[queueStatus]}帖子`}</h2>
      </div>
      <span className="text-sm font-black text-slate-500">{posts.length} 条</span>
    </div>

    {/* 关键词搜索 */}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submitSearch() }}
        placeholder="搜索标题 / 正文 / 作者昵称 / UID / 帖子 ID"
        className="min-w-[220px] flex-1 rounded-full border border-sky-100 bg-white px-4 py-2 text-sm font-bold text-brand-950 outline-none focus:border-brand-500"
      />
      <button type="button" onClick={submitSearch} disabled={loading} className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-60">搜索</button>
      {keyword ? (
        <button type="button" onClick={() => { setSearchInput(''); setKeyword(''); void loadStatus(queueStatus, 1) }} disabled={loading} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-60">清除</button>
      ) : null}
    </div>

    <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="帖子审核状态">
      {reviewFilters.map((status) => <button key={status} type="button" role="tab" aria-selected={status === queueStatus} disabled={loading || Boolean(reviewingId) || status === queueStatus} onClick={() => void loadStatus(status, 1)} className={`rounded-full px-4 py-2 text-sm font-black ${status === queueStatus ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'} disabled:opacity-60`}>{statusLabels[status]}</button>)}
    </div>
    <div className="mt-5 divide-y divide-sky-100">
      {posts.map((post) => {
        const isReviewing = reviewingId === post.id
        const imageItems = post.PostMedia.flatMap((media, index) => media.url ? [{ id: media.id, src: media.url, previewSrc: media.thumbnail || undefined, alt: `帖子图片 ${index + 1}` }] : [])
        return <article key={post.id} className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500">
              <span className="rounded-full bg-sky-50 px-3 py-1 text-brand-700">[{post.Board.name}]</span>
              <span>{post.User.nickname || 'E院用户'}</span>
              <span>UID {post.User.uid}</span>
              {isPrivilegedAuthorRole(post.User?.role) ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">管理员帖</span> : null}
              <time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt))}</time>
              {post.reviewedAt ? <time>审核时间：{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.reviewedAt))}</time> : null}
              {post.reviewedAt ? <span>审核人：{post.ReviewedBy ? `${post.ReviewedBy.name} · UID ${post.ReviewedBy.uid}` : '原管理员账号已不存在'}</span> : null}
            </div>
            {(() => {
              const canChooseBoard = post.moderationStatus === 'PENDING' || post.moderationStatus === 'REJECTED'
              const selectedBoardId = publishBoardByPostId[post.id] || post.boardId
              const originalBoardName = post.Board.name
              const boardOptions: ReviewBoardOption[] = boards.some((board) => board.id === post.boardId)
                ? boards
                : [{ id: post.boardId, name: originalBoardName, slug: '' }, ...boards]
              const selectedBoardName = boardOptions.find((board) => board.id === selectedBoardId)?.name || originalBoardName
              const adjusted = canChooseBoard && selectedBoardId !== post.boardId
              return <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-black text-slate-600">
                <span>投稿分区：<span className="text-brand-700">{originalBoardName}</span></span>
                {canChooseBoard ? <label className="flex items-center gap-1.5">发布分区：
                  <select
                    value={selectedBoardId}
                    disabled={Boolean(reviewingId)}
                    onChange={(event) => {
                      const next = event.target.value
                      setPublishBoardByPostId((current) => {
                        const copy = { ...current }
                        if (!next) delete copy[post.id]
                        else copy[post.id] = next
                        return copy
                      })
                    }}
                    className="max-w-56 rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs font-black text-brand-950 outline-none focus:border-brand-500 disabled:opacity-60"
                  >
                    {boardOptions.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                  </select>
                </label> : null}
                {adjusted ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">已调整分区：{originalBoardName} → {selectedBoardName}</span> : null}
              </div>
            })()}
            <h3 className="mt-3 text-xl font-black text-brand-950">{post.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{post.content}</p>
            {post.moderationStatus === 'REJECTED' && post.rejectionReason ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">拒绝原因：{post.rejectionReason}</p> : null}
            {post.PostModerationHistory.length ? <details className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2"><summary className="cursor-pointer text-xs font-black text-brand-700">查看审核历史（{post.PostModerationHistory.length}）</summary><div className="mt-3 space-y-2">{post.PostModerationHistory.map((item) => <div key={item.id} className="border-t border-sky-100 pt-2 text-xs font-bold text-slate-600"><p>{item.action} · {item.status} · {item.actorName || '原账号已不存在'}{item.actorUid ? ` · UID ${item.actorUid}` : ''}</p><p className="mt-1 text-slate-500">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}{item.rejectionReason ? ` · ${item.rejectionReason}` : ''}</p></div>)}</div></details> : null}
            {imageItems.length ? <div className="mt-4 flex flex-wrap gap-3" aria-label={`帖子图片，共 ${imageItems.length} 张`}>{imageItems.map((item, index) => <ImageViewer key={item.id} src={item.src} previewSrc={item.previewSrc} alt={item.alt} gallery={imageItems} initialIndex={index} imageClassName="h-28 w-40 rounded-xl object-cover" buttonClassName="block h-28 w-40 cursor-zoom-in overflow-hidden rounded-xl bg-slate-100 text-left" />)}</div> : null}
          </div>
          <div className="flex flex-wrap items-start gap-2 md:w-32 md:flex-col">
            {post.moderationStatus === 'PENDING' ? <><button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'APPROVED')} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">通过</button><button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'REJECTED')} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-60">拒绝</button></> : null}
            {post.moderationStatus === 'APPROVED' ? <button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'REJECTED')} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-60">拒绝通过</button> : null}
            {post.moderationStatus === 'REJECTED' ? <button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'APPROVED')} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">重新通过</button> : null}
            {post.isFeatured ? (
              <button type="button" disabled={Boolean(reviewingId) || Boolean(flaggingId)} onClick={() => setFeatureConfirm({ postId: post.id, title: post.title, nextIsFeatured: false })} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-60">取消精华</button>
            ) : canFeaturePost(post) ? (
              <button type="button" disabled={Boolean(reviewingId) || Boolean(flaggingId)} onClick={() => setFeatureConfirm({ postId: post.id, title: post.title, nextIsFeatured: true })} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-60">设为精华</button>
            ) : (
              <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-400">仅超管可加精</span>
            )}
            <button type="button" disabled={Boolean(reviewingId)} onClick={() => void toggleFlag(post.id, 'isPinned', !post.isPinned)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-60">{post.isPinned ? '取消置顶' : '置顶'}</button>
            {isReviewing ? <span className="text-xs font-black text-slate-500">提交中…</span> : null}
          </div>
        </article>
      })}
      {!posts.length ? <p className="py-10 text-center text-sm font-bold text-slate-500">暂无{queueStatus === 'ALL' ? '帖子' : `${statusLabels[queueStatus]}帖子`}。</p> : null}
    </div>
    <div className="mt-5 flex items-center justify-center gap-3 border-t border-sky-100 pt-5">
      <button type="button" disabled={loading || page <= 1} onClick={() => void loadStatus(queueStatus, page - 1)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">上一页</button>
      <span className="text-sm font-black text-slate-500">第 {page} 页</span>
      <button type="button" disabled={loading || !hasMore} onClick={() => void loadStatus(queueStatus, page + 1)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">下一页</button>
    </div>
    {reviewTarget ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewTarget(null) }}>
      <div className="w-full max-w-lg rounded-3xl border border-sky-100 bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="post-review-dialog-title">
        <h3 id="post-review-dialog-title" className="text-xl font-black text-brand-950">确认{reviewTarget.nextStatus === 'APPROVED' ? '通过' : '拒绝'}帖子</h3>
        <p className="mt-3 break-words text-sm font-bold leading-6 text-slate-600">{reviewTarget.title}</p>
        {reviewTarget.nextStatus === 'REJECTED' ? <label className="mt-5 block text-sm font-black text-brand-950">拒绝原因（必填）<textarea required value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={5} className="mt-2 max-h-48 min-h-28 w-full resize-y overflow-y-auto rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-brand-500" placeholder="请填写拒绝原因，用户会在审核通知中看到。" /></label> : null}
        <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => setReviewTarget(null)} className="rounded-full bg-sky-50 px-5 py-2.5 text-sm font-black text-brand-700">取消</button><button type="button" onClick={() => void confirmReview()} className={`rounded-full px-5 py-2.5 text-sm font-black text-white ${reviewTarget.nextStatus === 'APPROVED' ? 'bg-emerald-600' : 'bg-red-600'}`}>确认{reviewTarget.nextStatus === 'APPROVED' ? '通过' : '拒绝'}</button></div>
      </div>
    </div> : null}
    {featureConfirm ? <PostFeatureConfirmDialog
      open
      nextIsFeatured={featureConfirm.nextIsFeatured}
      loading={Boolean(flaggingId)}
      error={error}
      onConfirm={() => { if (featureConfirm) void toggleFlag(featureConfirm.postId, 'isFeatured', featureConfirm.nextIsFeatured) }}
      onCancel={() => setFeatureConfirm(null)}
    /> : null}
  </section>
}
