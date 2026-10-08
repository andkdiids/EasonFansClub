'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TopicActivityImagePicker } from '@/components/activities/TopicActivityImagePicker'
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

function SourceImage({ asset, alt, className }: { asset: TopicActivityUploadedAsset; alt: string; className: string }) {
  return <div className="flex flex-col items-start gap-1"><img src={asset.thumbnailUrl || asset.url} alt={alt} className={className} />{asset.originalDownloadUrl ? <a href={asset.originalDownloadUrl} download className="text-xs font-bold text-emerald-700 underline dark:text-emerald-300">下载原图</a> : null}</div>
}

export function TopicActivityFormSubmissionManager({ activityId, onClose, userId = null }: { activityId: string; onClose: () => void; userId?: string | null }) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [counts, setCounts] = useState<SubmissionCounts | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [images, setImages] = useState<TopicActivityUploadedAsset[]>([])
  const [filter, setFilter] = useState<'ALL' | 'REPLIED' | 'UNREPLIED'>('ALL')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const replyLockRef = useRef(false)
  const load = useCallback(async (nextPage = 1, append = false) => {
    if (!append) setLoading(true)
    setError('')
    try {
      const userQuery = userId ? `&userId=${encodeURIComponent(userId)}` : ''
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/form-submissions?replyStatus=${filter}${userQuery}&page=${nextPage}&pageSize=20`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '表单提交暂时无法加载')
      const rows: Submission[] = Array.isArray(data?.submissions) ? data.submissions : []
      setSubmissions((current) => append ? [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))] : rows)
      setCounts(data?.counts || null)
      setPage(Number(data?.page) || nextPage)
      setHasMore(data?.hasMore === true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '表单提交暂时无法加载') }
    finally { if (!append) setLoading(false) }
  }, [activityId, filter, userId])
  useEffect(() => { void load() }, [load])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try { await load(page + 1, true) }
    finally { setLoadingMore(false) }
  }

  async function reply(submissionId: string) {
    if (replyLockRef.current || busy || uploading || (!content.trim() && !images.length)) return
    replyLockRef.current = true
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/admin/topic-activity-form-submissions/${encodeURIComponent(submissionId)}/replies`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, assetIds: images.map((image) => image.assetId) }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '回复失败')
      setContent(''); setImages([]); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '回复失败') }
    finally { replyLockRef.current = false; setBusy(false) }
  }

  return <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black tracking-[0.15em] text-emerald-700 dark:text-emerald-300">TOPIC ACTIVITY</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">参与表单管理</h2></div><button type="button" onClick={onClose} className="rounded-full border px-4 py-2 text-sm font-bold">关闭</button></div>
    {counts ? <p className="mt-3 text-xs font-bold text-slate-500">评论提交 {counts.commentSubmissions} · 表单提交 {counts.formSubmissions}（已回复 {counts.repliedForms} / 未回复 {counts.unrepliedForms}）· 通过用户 {counts.approvedUsers}</p> : null}<div className="mt-4 flex flex-wrap gap-2">{[['ALL', '全部'], ['REPLIED', '已回复'], ['UNREPLIED', '未回复']].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value as 'ALL' | 'REPLIED' | 'UNREPLIED')} className={`rounded-full px-3 py-2 text-sm font-bold ${filter === value ? 'bg-emerald-700 text-white' : 'border border-slate-200 dark:border-slate-700'}`}>{label}</button>)}</div>
    {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}{loading ? <p className="py-8 text-center text-sm text-slate-500">正在加载…</p> : !submissions.length ? <p className="py-8 text-center text-sm text-slate-500">暂无表单提交</p> : <div className="mt-4 space-y-3">{submissions.map((submission) => { const expanded = selectedId === submission.id; const replied = submission.status === 'REPLIED' || submission.replies.length > 0; return <article key={submission.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{submission.user?.avatarUrl ? <img src={submission.user.avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 font-black dark:bg-slate-800">{(submission.user?.nickname || '用').slice(0, 1)}</span>}<div className="min-w-0"><p className="break-words font-black">{submission.user?.nickname || '用户'} <span className="ml-2 text-xs font-bold text-slate-500">提交 #{submission.id.slice(-6)} · {replied ? '已回复' : '未回复'}</span></p><time className="mt-1 block text-xs text-slate-500">{new Date(submission.submittedAt).toLocaleString()}</time></div></div><button type="button" onClick={() => { setSelectedId(expanded ? null : submission.id); setContent(''); setImages([]) }} className="rounded-lg border px-3 py-2 text-sm font-bold">{expanded ? '收起详情' : '查看详情 / 回复'}</button></div>
      {expanded ? <><div className="mt-4 space-y-3">{submission.answersSnapshot.map((answer) => <div key={answer.fieldId} className="text-sm"><p className="font-black">{answer.label}</p>{answer.type === 'IMAGE' && Array.isArray(answer.value) ? <div className="mt-1 flex flex-wrap gap-2">{answer.value.map((item) => typeof item === 'string' ? null : <SourceImage key={item.assetId} asset={item} alt="用户表单字段图片" className="size-28 rounded-lg object-cover" />)}</div> : <p className="mt-1 whitespace-pre-wrap">{answer.displayValue || (Array.isArray(answer.value) ? answer.value.join('、') : answer.value)}</p>}</div>)}{submission.attachments?.length ? <div className="text-sm"><p className="font-black">表单图片附件</p><div className="mt-1 flex flex-wrap gap-2">{submission.attachments.map((image) => <SourceImage key={image.assetId} asset={image} alt="用户表单附件" className="size-28 rounded-lg object-cover" />)}</div></div> : null}</div>
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="text-sm font-black">管理员回复历史</h3>{submission.replies.map((replyItem) => { const replyImages = replyItem.images || replyItem.attachments || []; return <div key={replyItem.id} className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><time className="text-xs text-slate-500">{new Date(replyItem.createdAt).toLocaleString()}</time>{replyItem.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{replyItem.content}</p> : null}<div className="mt-2 flex gap-2">{replyImages.map((image) => <img key={image.assetId} src={image.thumbnailUrl || image.url} alt="回复附件" className="size-20 rounded object-cover" />)}</div></div> })}<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} rows={3} placeholder="回复用户（可选）" className="mt-3 w-full rounded-lg border border-slate-200 bg-transparent p-3 text-sm dark:border-slate-700" /><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><TopicActivityImagePicker activityId={activityId} purpose="ADMIN_REPLY" assets={images} onChange={setImages} onUploadingChange={setUploading} maxImages={9} disabled={busy || uploading} /><button disabled={busy || uploading || (!content.trim() && !images.length)} type="button" onClick={() => void reply(submission.id)} className="min-h-10 rounded-lg bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">{busy ? '发送中…' : '发送回复'}</button></div></div>
      </> : null}</article> })}{hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="min-h-10 rounded-lg border px-4 text-sm font-bold disabled:opacity-50">{loadingMore ? '加载中…' : '加载更多'}</button> : null}</div>}
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
