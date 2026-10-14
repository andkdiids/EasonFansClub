'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TopicActivityImagePicker } from '@/components/activities/TopicActivityImagePicker'
import { TopicActivityOriginalImage } from '@/components/activities/TopicActivityOriginalImage'
import { TopicActivityAssetImage } from '@/components/activities/TopicActivityAssetImage'
import { TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT } from '@/components/activities/TopicActivityFormParticipation'
import type { TopicActivityUploadedAsset } from '@/lib/content-image-browser'

type Submission = {
  id: string
  user?: { id: string; nickname: string; avatarUrl: string | null }
  status: 'SUBMITTED' | 'REPLIED'
  submittedAt: string
  answersSnapshot: Array<{ fieldId: string; label: string; type: string; value: string | string[] | TopicActivityUploadedAsset[]; displayValue?: string }>
  attachments?: TopicActivityUploadedAsset[]
  replies: Array<{ id: string; content: string | null; createdAt: string; images?: TopicActivityUploadedAsset[]; attachments?: TopicActivityUploadedAsset[] }>
}

type SubmissionCounts = { commentSubmissions: number; formSubmissions: number; repliedForms: number; unrepliedForms: number; approvedUsers: number }
const FORM_LIST_SAFETY_LIMIT = 1000

function SourceImage({ asset, alt, className }: { asset: TopicActivityUploadedAsset; alt: string; className: string }) {
  return <div className="flex flex-col items-start gap-1"><TopicActivityAssetImage src={asset.thumbnailAccessUrl || asset.previewAccessUrl || asset.thumbnailUrl || asset.url} alt={alt} className={className} />{asset.originalDownloadUrl ? <TopicActivityOriginalImage originalUrl={asset.originalDownloadUrl} /> : null}</div>
}

export function TopicActivityFormSubmissionManager({ activityId, onClose, userId = null }: { activityId: string; onClose: () => void; userId?: string | null }) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [counts, setCounts] = useState<SubmissionCounts | null>(null)
  const [page, setPage] = useState(1)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [images, setImages] = useState<TopicActivityUploadedAsset[]>([])
  const [filter, setFilter] = useState<'ALL' | 'REPLIED' | 'UNREPLIED'>('ALL')
  const [sort, setSort] = useState<'OLDEST' | 'NEWEST'>('OLDEST')
  const [total, setTotal] = useState(0)
  const [loadedCount, setLoadedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [nextRetry, setNextRetry] = useState(false)
  const replyLockRef = useRef(false)
  const loadMoreLockRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)
  const listRequestRef = useRef(0)
  const nextFocusRef = useRef<string | null>(null)
  const loadedIdsRef = useRef(new Set<string>())
  const stopLoadingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const load = useCallback(async (nextPage = 1, append = false, cursor: string | null = null) => {
    const serial = ++listRequestRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 45000)
    if (!append) setLoading(true)
    setError('')
    try {
      const userQuery = userId ? `&userId=${encodeURIComponent(userId)}` : ''
      const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/form-submissions?replyStatus=${filter}&sort=${sort}${userQuery}&page=${nextPage}&pageSize=20${cursorQuery}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '表单提交暂时无法加载')
      if (serial !== listRequestRef.current) return null
      const rows: Submission[] = Array.isArray(data?.submissions) ? data.submissions : []
      if (!append) loadedIdsRef.current.clear()
      rows.forEach((row) => loadedIdsRef.current.add(row.id))
      setLoadedCount(loadedIdsRef.current.size)
      setTotal(Number(data?.total) || 0)
      setSubmissions((current) => {
        const ids = new Set(current.map((row) => row.id))
        return append ? [...current, ...rows.filter((row) => !ids.has(row.id))] : rows
      })
      setCounts(data?.counts || null)
      setPage(Number(data?.page) || nextPage)
      setHasMore(data?.hasMore === true)
      setNextCursor(typeof data?.nextCursor === 'string' ? data.nextCursor : null)
      return { page: Number(data?.page) || nextPage, hasMore: data?.hasMore === true, nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null }
    } catch (cause) {
      if (serial === listRequestRef.current) setError(controller.signal.aborted ? '加载已中断，已加载记录保留，可重试剩余部分' : cause instanceof Error ? cause.message : '表单提交暂时无法加载')
      return null
    } finally {
      window.clearTimeout(timeout)
      if (abortRef.current === controller) abortRef.current = null
      if (!append && serial === listRequestRef.current) setLoading(false)
    }
  }, [activityId, filter, sort, userId])
  useEffect(() => {
    setSelectedId(null); setNotice(''); setNextRetry(false)
    setSubmissions([]); setNextCursor(null); setPage(1); setHasMore(false); setLoadedCount(0); setTotal(0)
    void load()
    return () => { stopLoadingRef.current = true; listRequestRef.current += 1; abortRef.current?.abort() }
  }, [load])
  useEffect(() => {
    if (nextFocusRef.current !== selectedId) return
    document.getElementById(`admin-form-${selectedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    nextFocusRef.current = null
  }, [selectedId, submissions])

  async function loadMore() {
    if (loadingMore || loadMoreLockRef.current || busy || !hasMore) return
    loadMoreLockRef.current = true
    stopLoadingRef.current = false
    setLoadingMore(true)
    setNotice('')
    try {
      let cursor = nextCursor
      let nextPage = page + 1
      while (!stopLoadingRef.current && loadedIdsRef.current.size < FORM_LIST_SAFETY_LIMIT) {
        const result = await load(nextPage, true, cursor)
        if (!result || !result.hasMore) break
        if (!result.nextCursor || result.nextCursor === cursor) { setError('分页位置未更新，已停止加载；请重新选择排序后重试'); break }
        cursor = result.nextCursor
        nextPage = result.page + 1
        // Yield between bounded pages so a large queue does not block input/paint.
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      if (loadedIdsRef.current.size >= FORM_LIST_SAFETY_LIMIT) setNotice('为保持页面流畅，最多加载 1000 份；请用回复状态筛选缩小范围')
    }
    finally { loadMoreLockRef.current = false; setLoadingMore(false) }
  }

  async function openNextUnreplied(completedId: string | null = null) {
    setNextRetry(false)
    try {
      const userQuery = userId ? `&userId=${encodeURIComponent(userId)}` : ''
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/form-submissions?replyStatus=UNREPLIED&sort=${sort}${userQuery}&pageSize=1`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '下一份待回复表单暂时无法加载')
      const next: Submission | undefined = data?.submissions?.[0]
      if (next && (next.id === completedId || next.status === 'REPLIED' || next.replies.length > 0)) throw new Error('下一份状态已变化，请重试定位')
      if (data?.counts) setCounts(data.counts)
      if (!next) { setNotice('当前待回复表单已处理完成'); return }
      setSubmissions((current) => current.some((row) => row.id === next.id) ? current.map((row) => row.id === next.id ? next : row) : [...current, next])
      nextFocusRef.current = next.id
      setSelectedId(next.id)
      setNotice('回复已发送，已打开下一份待回复表单')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '下一份待回复表单暂时无法加载'); setNextRetry(true) }
  }

  async function reply(submissionId: string) {
    if (replyLockRef.current || busy || uploading || loadingMore || (!content.trim() && !images.length)) return
    replyLockRef.current = true
    setBusy(true); setError('')
    try {
      if (!requestIdRef.current) requestIdRef.current = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')
      const response = await fetch(`/api/admin/topic-activity-form-submissions/${encodeURIComponent(submissionId)}/replies`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, assetIds: images.map((image) => image.assetId), requestId: requestIdRef.current }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '回复失败')
      if (!data?.reply?.id) throw new Error('回复结果暂时无法确认，请重试；同一请求不会重复发送')
      const wasReplied = submissions.some((row) => row.id === submissionId && (row.status === 'REPLIED' || row.replies.length > 0))
      setSubmissions((current) => current.map((row) => row.id === submissionId ? { ...row, status: 'REPLIED', replies: row.replies.some((item) => item.id === data.reply.id) ? row.replies : [...row.replies, data.reply] } : row))
      if (!wasReplied && filter === 'UNREPLIED') {
        loadedIdsRef.current.delete(submissionId)
        setLoadedCount(loadedIdsRef.current.size)
        setTotal((current) => Math.max(0, current - 1))
      } else if (!wasReplied && filter === 'REPLIED') {
        loadedIdsRef.current.add(submissionId)
        setLoadedCount(loadedIdsRef.current.size)
        setTotal((current) => current + 1)
      }
      if (!wasReplied) setCounts((current) => current ? { ...current, repliedForms: current.repliedForms + 1, unrepliedForms: Math.max(0, current.unrepliedForms - 1) } : current)
      setContent(''); setImages([]); requestIdRef.current = null
      setNotice('回复已发送')
      await openNextUnreplied(submissionId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '回复失败') }
    finally { replyLockRef.current = false; setBusy(false) }
  }

  const visibleSubmissions = submissions.filter((row) => filter === 'ALL' || (filter === 'REPLIED' ? row.status === 'REPLIED' : row.status !== 'REPLIED'))
  // A next-queue editor is separate from the filtered page. Keep the user's
  // REPLIED filter and its cursor, but never select an invisible pending row.
  const queueSubmission = filter === 'REPLIED' ? submissions.find((row) => row.id === selectedId && row.status !== 'REPLIED') : null
  const displaySubmissions = queueSubmission ? [queueSubmission, ...visibleSubmissions] : visibleSubmissions
  return <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black tracking-[0.15em] text-emerald-700 dark:text-emerald-300">TOPIC ACTIVITY</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">参与表单管理</h2></div><button type="button" disabled={busy || uploading} onClick={onClose} className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-40">关闭</button></div>
    {counts ? <p className="mt-3 text-xs font-bold text-slate-500">评论提交 {counts.commentSubmissions} · 表单提交 {counts.formSubmissions}（已回复 {counts.repliedForms} / 未回复 {counts.unrepliedForms}）· 通过用户 {counts.approvedUsers}</p> : null}<div className="mt-4 flex flex-wrap gap-2">{[['ALL', '全部'], ['REPLIED', '已回复'], ['UNREPLIED', '未回复']].map(([value, label]) => <button key={value} type="button" disabled={busy || uploading || loadingMore} onClick={() => setFilter(value as 'ALL' | 'REPLIED' | 'UNREPLIED')} className={`rounded-full px-3 py-2 text-sm font-bold disabled:opacity-40 ${filter === value ? 'bg-emerald-700 text-white' : 'border border-slate-200 dark:border-slate-700'}`}>{label}</button>)}</div>
    <label className="mt-3 flex items-center gap-2 text-sm font-bold">排序<select aria-label="提交排序" value={sort} disabled={busy || uploading || loadingMore} onChange={(event) => setSort(event.target.value as 'OLDEST' | 'NEWEST')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="OLDEST">最早提交</option><option value="NEWEST">最新提交</option></select></label>
    {loadingMore ? <div role="status" className="mt-3 flex items-center gap-3 text-sm"><span>正在加载 {loadedCount} / {total}……</span><button type="button" onClick={() => { stopLoadingRef.current = true; abortRef.current?.abort() }} className="rounded border px-3 py-1">停止加载</button></div> : null}
    {notice ? <p role="status" className="mt-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-300">{error}</p> : null}
    {nextRetry ? <button type="button" disabled={busy} onClick={() => { setError(''); void openNextUnreplied() }} className="mt-2 rounded-lg border px-3 py-2 text-sm">重试定位下一份（不会重发回复）</button> : null}
    {loading ? <p className="py-8 text-center text-sm text-slate-500">正在加载…</p> : !displaySubmissions.length && !hasMore ? <p className="py-8 text-center text-sm text-slate-500">暂无表单提交</p> : <div className="mt-4 space-y-3">{displaySubmissions.map((submission) => { const expanded = selectedId === submission.id; const replied = submission.status === 'REPLIED' || submission.replies.length > 0; return <article style={expanded ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 110px' }} key={submission.id} id={`admin-form-${submission.id}`} className="scroll-mt-16 rounded-xl border border-slate-200 p-4 dark:border-slate-700">{queueSubmission?.id === submission.id ? <p className="mb-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">下一份待回复 · 列表仍按已回复筛选</p> : null}<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{submission.user?.avatarUrl ? <img loading="lazy" src={submission.user.avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 font-black dark:bg-slate-800">{(submission.user?.nickname || '用').slice(0, 1)}</span>}<div className="min-w-0"><p className="break-words font-black">{submission.user?.nickname || '用户'} <span className="ml-2 text-xs font-bold text-slate-500">提交 #{submission.id.slice(-6)} · {replied ? '已回复' : '未回复'}</span></p><time className="mt-1 block text-xs text-slate-500">{new Date(submission.submittedAt).toLocaleString()}</time></div></div><button type="button" disabled={busy || uploading} onClick={() => { setSelectedId(expanded ? null : submission.id); setContent(''); setImages([]); requestIdRef.current = null }} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-40">{expanded ? '收起详情' : '查看详情 / 回复'}</button></div>
      {expanded ? <><div className="mt-4 space-y-3">{submission.answersSnapshot.map((answer) => <div key={answer.fieldId} className="text-sm"><p className="font-black">{answer.label}</p>{answer.type === 'IMAGE' && Array.isArray(answer.value) ? <div className="mt-1 flex flex-wrap gap-2">{answer.value.map((item) => typeof item === 'string' ? null : <SourceImage key={item.assetId} asset={item} alt="用户表单字段图片" className="size-28 rounded-lg object-cover" />)}</div> : <p className="mt-1 whitespace-pre-wrap">{answer.displayValue || (Array.isArray(answer.value) ? answer.value.join('、') : answer.value)}</p>}</div>)}{submission.attachments?.length ? <div className="text-sm"><p className="font-black">表单图片附件</p><div className="mt-1 flex flex-wrap gap-2">{submission.attachments.map((image) => <SourceImage key={image.assetId} asset={image} alt="用户表单附件" className="size-28 rounded-lg object-cover" />)}</div></div> : null}</div>
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="text-sm font-black">管理员回复历史</h3>{submission.replies.map((replyItem) => { const replyImages = replyItem.images || replyItem.attachments || []; return <div key={replyItem.id} className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><time className="text-xs text-slate-500">{new Date(replyItem.createdAt).toLocaleString()}</time>{replyItem.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{replyItem.content}</p> : null}<div className="mt-2 flex flex-wrap gap-2">{replyImages.map((image) => <SourceImage key={image.assetId} asset={image} alt="回复附件" className="size-20 rounded object-cover" />)}</div></div> })}<textarea disabled={busy} value={content} onChange={(event) => { setContent(event.target.value); requestIdRef.current = null }} maxLength={4000} rows={3} placeholder="回复用户（可选）" className="mt-3 w-full rounded-lg border border-slate-200 bg-transparent p-3 text-sm dark:border-slate-700" /><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><TopicActivityImagePicker activityId={activityId} purpose="ADMIN_REPLY" assets={images} onChange={(assets) => { setImages(assets); requestIdRef.current = null }} onUploadingChange={setUploading} maxImages={9} disabled={busy || uploading} /><button disabled={busy || uploading || loadingMore || (!content.trim() && !images.length)} type="button" onClick={() => void reply(submission.id)} className="min-h-10 rounded-lg bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">{busy ? '发送中…' : '发送回复'}</button></div></div>
      </> : null}</article> })}{hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore || busy || uploading || loadedCount >= FORM_LIST_SAFETY_LIMIT} className="min-h-10 rounded-lg border px-4 text-sm font-bold disabled:opacity-50">{loadingMore ? '加载中…' : `加载全部剩余（${Math.max(0, total - loadedCount)}）`}</button> : null}</div>}
  </section>
}

export function TopicActivityFormSubmissionEntry({ activityId, count, userId: requestedUserId = null }: { activityId: string; count: number; userId?: string | null }) {
  const [open, setOpen] = useState(false)
  const [liveCount, setLiveCount] = useState(count)
  const [userId, setUserId] = useState<string | null>(null)
  const refreshCount = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/form-submissions?pageSize=1`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (response.ok && typeof data?.counts?.formSubmissions === 'number') setLiveCount(data.counts.formSubmissions)
    } catch { /* Preserve the last known count; opening the manager can retry. */ }
  }, [activityId])
  useEffect(() => {
    const targetUser = requestedUserId || new URLSearchParams(window.location.search).get('formUserId')
    if (targetUser) { setUserId(targetUser); setOpen(true) }
    void refreshCount()
    const onSubmitted = (event: Event) => {
      const submittedEvent = event as CustomEvent<{ activityId: string }>
      if (submittedEvent.detail?.activityId === activityId) void refreshCount()
    }
    window.addEventListener(TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT, onSubmitted)
    window.addEventListener('focus', refreshCount)
    return () => {
      window.removeEventListener(TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT, onSubmitted)
      window.removeEventListener('focus', refreshCount)
    }
  }, [activityId, refreshCount, requestedUserId])
  return <div id={`topic-activity-admin-forms-${activityId}`} className="mt-5 scroll-mt-16">
    <button type="button" onClick={() => { setOpen((value) => !value); void refreshCount() }} aria-expanded={open} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-700 px-4 text-sm font-black text-emerald-800 dark:text-emerald-200">
      表单提交（{liveCount}）
    </button>
    {open ? <div className="mt-4">{userId ? <button type="button" onClick={() => setUserId(null)} className="mb-3 text-sm text-[var(--primary)]">查看全部用户表单</button> : null}<TopicActivityFormSubmissionManager activityId={activityId} userId={userId} onClose={() => setOpen(false)} /></div> : null}
  </div>
}
