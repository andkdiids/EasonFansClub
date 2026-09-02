'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { ReplyLengthCounter } from '@/components/ReplyLengthCounter'
import { Pagination } from '@/components/ui/Pagination'
import { getReplyLengthMetrics, replyTooLongMessage } from '@/lib/reply-length'

type FeedbackItem = {
  id: string
  title: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  adminUnread: boolean
  userUnread: boolean
  content?: string
  contact?: string | null
  createdAt: string
  updatedAt: string
  lastReplyAt?: string | null
  user: { uid: number; nickname: string; avatarUrl?: string | null }
  attachments?: Array<{ id?: string; url: string }>
  replies?: Array<{
    id: string
    content: string
    authorRole: string
    createdAt: string
    author: { uid: number; nickname: string; avatarUrl?: string | null }
    attachments: Array<{ id?: string; url: string }>
  }>
}

const statusOptions = [
  ['OPEN', '未处理'],
  ['PROCESSING', '处理中'],
  ['REPLIED', '已回复'],
  ['RESOLVED', '已完成'],
]

const typeOptions = [
  ['BUG', '问题反馈'],
  ['FEATURE', '功能建议'],
  ['EXPERIENCE', '体验建议'],
  ['ACCOUNT', '账号问题'],
  ['OTHER', '其他'],
]

const FEEDBACK_PAGE_SIZE = 20

function formatTime(value?: string | null) {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AdminFeedbackPanel({ initialFeedbackId }: { initialFeedbackId?: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [selectedId, setSelectedId] = useState(initialFeedbackId || '')
  const [detail, setDetail] = useState<FeedbackItem | null>(null)
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [reply, setReply] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [replying, setReplying] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [detailLoading, setDetailLoading] = useState(Boolean(initialFeedbackId))
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialFeedbackId))
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const detailRequestIdRef = useRef(0)
  const mobileSheetHistoryPushedRef = useRef(false)
  const previousHistoryStateRef = useRef<unknown>(null)
  const savedScrollYRef = useRef<number | null>(null)
  const replyDraftRef = useRef('')
  const mobileDetailOpenRef = useRef(Boolean(initialFeedbackId))
  const actionBusyRef = useRef(false)

  const actionBusy = replying || updatingStatus

  useEffect(() => {
    replyDraftRef.current = reply
  }, [reply])

  useEffect(() => {
    mobileDetailOpenRef.current = mobileDetailOpen
  }, [mobileDetailOpen])

  useEffect(() => {
    actionBusyRef.current = actionBusy
  }, [actionBusy])

  const requestCloseMobileDetail = useCallback(() => {
    if (!mobileDetailOpenRef.current || actionBusyRef.current) return
    if (replyDraftRef.current.trim() && !window.confirm('回复内容尚未保存，确定关闭吗？')) return

    const shouldPopHistory = mobileSheetHistoryPushedRef.current
    const historyState = window.history.state as { ecfcAdminFeedbackSheet?: boolean } | null
    mobileSheetHistoryPushedRef.current = false
    setMobileDetailOpen(false)
    if (shouldPopHistory && historyState?.ecfcAdminFeedbackSheet) window.history.go(-1)
  }, [])

  useEffect(() => {
    if (!mobileDetailOpen) return

    const media = window.matchMedia('(max-width: 767px)')
    if (!media.matches) return

    const body = document.body
    const savedScrollY = window.scrollY
    const previousBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    savedScrollYRef.current = savedScrollY
    previousHistoryStateRef.current = window.history.state

    const historyState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {}
    if (!mobileSheetHistoryPushedRef.current) {
      window.history.pushState({ ...historyState, ecfcAdminFeedbackSheet: true }, '')
      mobileSheetHistoryPushedRef.current = true
    }

    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    const closeOnDesktopResize = () => {
      if (!media.matches) requestCloseMobileDetail()
    }
    const onPopState = () => {
      if (!mobileSheetHistoryPushedRef.current) return
      if (window.history.state?.ecfcAdminFeedbackSheet) return
      mobileSheetHistoryPushedRef.current = false
      setMobileDetailOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestCloseMobileDetail()
    }

    media.addEventListener('change', closeOnDesktopResize)
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onEscape)

    return () => {
      media.removeEventListener('change', closeOnDesktopResize)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onEscape)
      if (mobileSheetHistoryPushedRef.current && window.history.state?.ecfcAdminFeedbackSheet) {
        mobileSheetHistoryPushedRef.current = false
        window.history.replaceState(previousHistoryStateRef.current, '')
      }
      body.style.position = previousBodyStyle.position
      body.style.top = previousBodyStyle.top
      body.style.left = previousBodyStyle.left
      body.style.right = previousBodyStyle.right
      body.style.width = previousBodyStyle.width
      body.style.overflow = previousBodyStyle.overflow
      const restoreScrollY = savedScrollYRef.current
      if (restoreScrollY !== null) window.scrollTo({ top: restoreScrollY, behavior: 'auto' })
      savedScrollYRef.current = null
      previousHistoryStateRef.current = null
    }
  }, [mobileDetailOpen, requestCloseMobileDetail])

  useEffect(() => {
    loadList()
  }, [page])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId])

  useEffect(() => {
    const onRealtimeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ changed?: string[]; source?: string }>).detail
      if (detail?.source !== 'fallback' && !detail?.changed?.includes('feedback')) return
      void loadList()
      if (selectedId) void loadDetail(selectedId)
    }
    window.addEventListener('realtime:event', onRealtimeEvent)
    return () => window.removeEventListener('realtime:event', onRealtimeEvent)
  }, [selectedId, page])

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || '操作失败')
    return data
  }

  async function loadList(nextPage = page) {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (type) params.set('type', type)
    if (q) params.set('q', q)
    params.set('page', String(nextPage))
    params.set('pageSize', String(FEEDBACK_PAGE_SIZE))
    try {
      const data = await requestJson(`/api/admin/feedback?${params.toString()}`)
      setItems(data.feedbacks || [])
      setTotal(Number(data.total || 0))
      if (!selectedId && data.feedbacks?.[0]) setSelectedId(data.feedbacks[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '反馈列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    const requestId = ++detailRequestIdRef.current
    setDetailLoading(true)
    try {
      const data = await requestJson(`/api/admin/feedback/${id}`)
      if (requestId !== detailRequestIdRef.current) return
      setDetail(data.feedback)
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...data.feedback } : item)))
    } catch (err) {
      if (requestId === detailRequestIdRef.current) setError(err instanceof Error ? err.message : '反馈详情加载失败')
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false)
    }
  }

  function openFeedbackDetail(id: string) {
    if (id !== selectedId && replyDraftRef.current.trim() && !window.confirm('回复内容尚未保存，确定切换反馈吗？')) return

    const needsDetail = id !== selectedId || detail?.id !== id
    setSelectedId(id)
    setMobileDetailOpen(true)
    setMessage('')
    setError('')
    if (needsDetail) {
      setDetail(null)
      setReply('')
      setDetailLoading(true)
      if (id === selectedId && !detailLoading) void loadDetail(id)
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault()
    if (!detail || actionBusy) return
    const replyLength = getReplyLengthMetrics(reply)
    if (replyLength.exceededBy > 0) {
      setError(replyTooLongMessage(replyLength))
      return
    }
    setReplying(true)
    setError('')
    setMessage('')
    try {
      const data = await requestJson(`/api/admin/feedback/${detail.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply }),
      })
      setDetail(data.feedback)
      setItems((current) => current.map((item) => (item.id === detail.id ? { ...item, ...data.feedback } : item)))
      setReply('')
      setMessage('回复已发送，用户会收到站内通知')
    } catch (err) {
      setError(err instanceof Error ? err.message : '回复失败')
    } finally {
      setReplying(false)
    }
  }

  async function updateStatus(nextStatus: string) {
    if (!detail || actionBusy || detail.status === nextStatus) return
    setUpdatingStatus(true)
    setError('')
    setMessage('')
    try {
      const data = await requestJson(`/api/admin/feedback/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      setDetail(data.feedback)
      setItems((current) => current.map((item) => (item.id === detail.id ? { ...item, ...data.feedback } : item)))
      setMessage('状态已更新')
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态更新失败')
    } finally {
      setUpdatingStatus(false)
    }
  }

  function applyFilters() {
    setPage(1)
    loadList(1)
  }

  const visibleReplies = detail
    ? (detail.replies || []).filter((item) => !(item.authorRole === 'USER' && item.content === detail.content && Math.abs(new Date(item.createdAt).getTime() - new Date(detail.createdAt).getTime()) < 10_000))
    : []

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Feedback Admin</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">反馈中心</h1>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

      <section className="grid gap-5 md:grid-cols-[380px_1fr]">
        <aside className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="搜索标题、昵称、UID" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
              <option value="">全部状态</option>
              {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
              <option value="">全部分类</option>
              {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={applyFilters} className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white">筛选</button>
          </div>

          <div className="mt-4 space-y-2">
            {loading ? <p className="p-3 text-sm font-bold text-slate-500">加载中...</p> : null}
            {!loading && !items.length ? <p className="rounded-2xl bg-sky-50 p-4 text-sm font-bold text-slate-500">没有匹配的反馈。</p> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openFeedbackDetail(item.id)}
                aria-pressed={selectedId === item.id}
                className={`admin-feedback-list-item w-full rounded-2xl p-3 text-left ${selectedId === item.id ? 'bg-sky-100' : 'bg-sky-50/70 hover:bg-sky-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-black text-brand-950">{item.title}</p>
                  {item.adminUnread ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">新</span> : null}
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500">{item.user.nickname} · UID {String(item.user.uid).padStart(5, '0')}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">{item.typeLabel} · {item.statusLabel}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">更新：{formatTime(item.updatedAt)}</p>
              </button>
            ))}
            {total > FEEDBACK_PAGE_SIZE ? (
              <Pagination
                currentPage={page}
                totalPages={Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE))}
                onPageChange={setPage}
                disabled={loading}
                ariaLabel="反馈分页"
                className="admin-feedback-pagination"
              />
            ) : null}
          </div>
        </aside>

        <button
          type="button"
          className="admin-feedback-detail-backdrop"
          data-open={mobileDetailOpen ? 'true' : 'false'}
          aria-label="关闭反馈详情"
          onClick={requestCloseMobileDetail}
        />

        <section
          className="admin-feedback-detail-shell rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm"
          data-mobile-open={mobileDetailOpen ? 'true' : 'false'}
          role="dialog"
          aria-modal={mobileDetailOpen ? true : undefined}
          aria-label="反馈详情"
        >
          <header className="admin-feedback-mobile-header">
            <button type="button" onClick={requestCloseMobileDetail} disabled={actionBusy} className="admin-feedback-mobile-back" aria-label="返回反馈列表">‹ 返回</button>
            <strong>反馈详情</strong>
            <button type="button" onClick={requestCloseMobileDetail} disabled={actionBusy} className="admin-feedback-mobile-close" aria-label="关闭反馈详情">×</button>
          </header>

          <div className="admin-feedback-detail-scroll">
            {detail ? (
              <div className="admin-feedback-detail-content space-y-5">
                <div className="border-b border-sky-100 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{detail.typeLabel}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{detail.statusLabel}</span>
                  </div>
                  <h2 className="mt-3 text-2xl font-black text-brand-950">{detail.title}</h2>
                  <p className="mt-2 text-xs font-bold text-slate-500">提交人：{detail.user.nickname} / UID {String(detail.user.uid).padStart(5, '0')} · 创建 {formatTime(detail.createdAt)} · 更新 {formatTime(detail.updatedAt)}</p>
                  {detail.contact ? <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-700">联系方式：{detail.contact}</p> : null}
                </div>

                {detail.content ? (
                  <section className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
                    <h3 className="text-xs font-black tracking-wide text-brand-700">反馈内容</h3>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-700">{detail.content}</p>
                    <AttachmentGrid attachments={detail.attachments} />
                  </section>
                ) : null}

                <div className="admin-feedback-detail-status-controls flex flex-wrap gap-2">
                  {statusOptions.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateStatus(value)}
                      disabled={actionBusy || detail.status === value}
                      aria-pressed={detail.status === value}
                      className={`rounded-full px-3 py-2 text-xs font-black disabled:cursor-wait disabled:opacity-60 ${detail.status === value ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}
                    >
                      {updatingStatus && detail.status !== value ? '更新中…' : label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {visibleReplies.map((item) => (
                    <div key={item.id} className={`rounded-2xl p-4 ${item.authorRole === 'ADMIN' ? 'bg-brand-50' : 'bg-sky-50/70'}`}>
                      <p className="text-xs font-black text-slate-500">{item.author.nickname} · {item.authorRole === 'ADMIN' ? '管理员回复' : '用户补充'} · {formatTime(item.createdAt)}</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-700">{item.content}</p>
                      <AttachmentGrid attachments={item.attachments} />
                    </div>
                  ))}
                </div>
              </div>
            ) : detailLoading ? (
              <div className="grid min-h-64 place-items-center text-sm font-bold text-slate-500" role="status">加载反馈详情中...</div>
            ) : (
              <div className="grid min-h-96 place-items-center text-sm font-bold text-slate-500">选择一条反馈查看详情</div>
            )}
          </div>

          {detail ? (
            <div className="admin-feedback-detail-actions">
              <div className="admin-feedback-detail-inline-feedback" aria-live="polite">
                {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">操作失败，请重试：{error}</p> : null}
                {message ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">{message}</p> : null}
              </div>
              {detail.status !== 'RESOLVED' && detail.status !== 'CLOSED' ? (
                <form onSubmit={submitReply} className="space-y-3">
                  <textarea
                    value={reply}
                    onChange={(e) => {
                      replyDraftRef.current = e.target.value
                      setReply(e.target.value)
                    }}
                    disabled={actionBusy}
                    className="min-h-28 w-full rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none disabled:opacity-60"
                    placeholder="回复用户"
                    aria-label="管理员回复内容"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3"><ReplyLengthCounter value={reply} /><button type="submit" disabled={actionBusy || getReplyLengthMetrics(reply).exceededBy > 0} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{replying ? '发送中...' : '回复并通知用户'}</button></div>
                </form>
              ) : (
                <p className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-black text-slate-500">该反馈已完成，如需回复请先改为处理中或已回复。</p>
              )}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  )
}

function AttachmentGrid({ attachments = [] }: { attachments?: Array<{ id?: string; url: string }> }) {
  const visible = attachments.filter((item) => item.url)
  if (!visible.length) return null
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {visible.map((item) => (
        <ImageViewer
          key={item.id || item.url}
          src={item.url}
          alt="反馈附件"
          imageClassName="h-28 w-full object-contain"
          buttonClassName="block w-full overflow-hidden rounded-2xl bg-white text-left"
        />
      ))}
    </div>
  )
}
