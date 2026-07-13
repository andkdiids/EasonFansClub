'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'

type Attachment = { id?: string; url: string; mimeType?: string | null }
type FeedbackReply = {
  id: string
  content: string
  authorRole: string
  createdAt: string
  author: { uid: number; nickname: string; avatarUrl?: string | null }
  attachments: Attachment[]
}
type FeedbackItem = {
  id: string
  title: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  userUnread: boolean
  adminUnread: boolean
  content?: string
  contact?: string | null
  createdAt: string
  lastReplyAt?: string | null
  attachments?: Attachment[]
  replies?: FeedbackReply[]
}
type ChangelogItem = {
  id: string
  version: string
  title: string
  content: string
  typeLabel: string
  isMajor: boolean
  publishedAt?: string | null
}

const typeOptions = [
  ['BUG', '功能异常'],
  ['EXPERIENCE', '使用体验'],
  ['SUGGESTION', '功能建议'],
  ['CONTENT', '内容问题'],
  ['ACCOUNT', '账号问题'],
  ['OTHER', '其他'],
]

function formatTime(value?: string | null) {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function FeedbackCenter({ initialFeedbackId }: { initialFeedbackId?: string }) {
  const [tab, setTab] = useState<'feedback' | 'changelog'>('feedback')
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([])
  const [selectedId, setSelectedId] = useState(initialFeedbackId || '')
  const [detail, setDetail] = useState<FeedbackItem | null>(null)
  const [changelogs, setChangelogs] = useState<ChangelogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [replying, setReplying] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', type: 'BUG', description: '', contact: '' })
  const [reply, setReply] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [replyAttachments, setReplyAttachments] = useState<Attachment[]>([])

  const selected = useMemo(() => feedbacks.find((item) => item.id === selectedId), [feedbacks, selectedId])

  useEffect(() => {
    loadFeedbacks()
    loadChangelogs()
  }, [])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId])

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || '操作失败，请稍后重试')
    return data
  }

  async function loadFeedbacks() {
    setLoading(true)
    try {
      const data = await requestJson('/api/feedback')
      setFeedbacks(data.feedbacks || [])
      if (!selectedId && data.feedbacks?.[0]) setSelectedId(data.feedbacks[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '反馈列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    try {
      const data = await requestJson(`/api/feedback/${id}`)
      setDetail(data.feedback)
      setFeedbacks((current) => current.map((item) => (item.id === id ? { ...item, ...data.feedback } : item)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '反馈详情加载失败')
    }
  }

  async function loadChangelogs() {
    try {
      const data = await requestJson('/api/changelog')
      setChangelogs(data.changelogs || [])
    } catch {
      setChangelogs([])
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>, target: 'create' | 'reply') {
    const files = Array.from(event.target.files || []).slice(0, 5)
    if (!files.length) return
    setError('')

    const current = target === 'create' ? attachments : replyAttachments
    if (current.length + files.length > 5) {
      setError('每条反馈最多上传 5 张图片')
      event.target.value = ''
      return
    }

    const uploaded: Attachment[] = []
    for (const file of files) {
      const body = new FormData()
      body.append('file', file)
      const data = await requestJson('/api/uploads/feedback-image', { method: 'POST', body })
      uploaded.push({ url: data.url, mimeType: data.mimeType })
    }

    if (target === 'create') setAttachments((items) => [...items, ...uploaded])
    else setReplyAttachments((items) => [...items, ...uploaded])
    event.target.value = ''
  }

  async function submitFeedback(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const data = await requestJson('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, attachments }),
      })
      setFeedbacks((items) => [data.feedback, ...items])
      setSelectedId(data.feedback.id)
      setDetail(data.feedback)
      setForm({ title: '', type: 'BUG', description: '', contact: '' })
      setAttachments([])
      setMessage('反馈已提交')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault()
    if (!detail || replying) return
    setReplying(true)
    setError('')
    setMessage('')
    try {
      const data = await requestJson(`/api/feedback/${detail.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply, attachments: replyAttachments }),
      })
      setDetail(data.feedback)
      setFeedbacks((items) => items.map((item) => (item.id === data.feedback.id ? { ...item, ...data.feedback } : item)))
      setReply('')
      setReplyAttachments([])
      setMessage('回复已发送')
    } catch (err) {
      setError(err instanceof Error ? err.message : '回复失败')
    } finally {
      setReplying(false)
    }
  }

  async function resolveFeedback() {
    if (!detail) return
    const data = await requestJson(`/api/feedback/${detail.id}/resolve`, { method: 'PATCH' })
    setDetail(data.feedback)
    setFeedbacks((items) => items.map((item) => (item.id === data.feedback.id ? { ...item, ...data.feedback } : item)))
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-5 shadow-sm sm:p-7">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Feedback</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">反馈与更新</h1>
        <div className="mt-5 flex gap-2">
          <button onClick={() => setTab('feedback')} className={`rounded-full px-4 py-2 text-sm font-black ${tab === 'feedback' ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>我的反馈</button>
          <button onClick={() => setTab('changelog')} className={`rounded-full px-4 py-2 text-sm font-black ${tab === 'changelog' ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>更新日志</button>
        </div>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      {tab === 'feedback' ? (
        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <form onSubmit={submitFeedback} className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
              <h2 className="text-xl font-black text-brand-950">新建反馈</h2>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-4 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none" placeholder="标题" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-3 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none">
                {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-3 min-h-32 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none" placeholder="详细描述" />
              <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="mt-3 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none" placeholder="联系方式（选填，仅本人和管理员可见）" />
              <label className="mt-3 inline-block cursor-pointer rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
                上传图片
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => upload(event, 'create')} className="hidden" />
              </label>
              {attachments.length ? <p className="mt-2 text-xs font-bold text-slate-500">已上传 {attachments.length} 张图片</p> : null}
              <button disabled={submitting} className="mt-4 w-full rounded-full bg-brand-950 px-4 py-3 text-sm font-black text-white disabled:opacity-60">{submitting ? '提交中...' : '提交反馈'}</button>
            </form>

            <div className="rounded-[24px] border border-sky-100 bg-white/88 p-3 shadow-sm">
              <h2 className="px-2 py-2 text-lg font-black text-brand-950">我的反馈</h2>
              {loading ? <p className="p-3 text-sm font-bold text-slate-500">加载中...</p> : null}
              {feedbacks.map((item) => (
                <button key={item.id} onClick={() => setSelectedId(item.id)} className={`mb-2 w-full rounded-2xl p-3 text-left transition ${selectedId === item.id ? 'bg-sky-100' : 'bg-sky-50/70 hover:bg-sky-50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-black text-brand-950">{item.title}</p>
                    {item.userUnread ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" /> : null}
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">{item.typeLabel} · {item.statusLabel}</p>
                  <p className="mt-1 text-xs font-bold text-slate-400">最后回复：{formatTime(item.lastReplyAt)}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
            {detail || selected ? (
              <FeedbackThread detail={detail || selected!} reply={reply} setReply={setReply} replyAttachments={replyAttachments} upload={upload} submitReply={submitReply} replying={replying} resolveFeedback={resolveFeedback} />
            ) : (
              <div className="grid min-h-80 place-items-center text-sm font-bold text-slate-500">选择一条反馈查看详情</div>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {changelogs.length === 0 ? <p className="rounded-2xl bg-white/85 p-6 text-sm font-bold text-slate-500">暂无已发布更新日志。</p> : null}
          {changelogs.map((item) => (
            <article key={item.id} className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-950 px-3 py-1 text-xs font-black text-white">{item.version}</span>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{item.typeLabel}</span>
                {item.isMajor ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">重大更新</span> : null}
              </div>
              <h2 className="mt-3 text-2xl font-black text-brand-950">{item.title}</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">{formatTime(item.publishedAt)}</p>
              <div className="mt-4 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-600">{item.content}</div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

function FeedbackThread({
  detail,
  reply,
  setReply,
  replyAttachments,
  upload,
  submitReply,
  replying,
  resolveFeedback,
}: {
  detail: FeedbackItem
  reply: string
  setReply: (value: string) => void
  replyAttachments: Attachment[]
  upload: (event: ChangeEvent<HTMLInputElement>, target: 'create' | 'reply') => Promise<void>
  submitReply: (event: FormEvent) => Promise<void>
  replying: boolean
  resolveFeedback: () => Promise<void>
}) {
  const isClosed = detail.status === 'CLOSED'
  return (
    <div className="space-y-5">
      <div className="border-b border-sky-100 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{detail.typeLabel}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{detail.statusLabel}</span>
        </div>
        <h2 className="mt-3 text-2xl font-black text-brand-950">{detail.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-600">{detail.content}</p>
        {detail.contact ? <p className="mt-3 rounded-2xl bg-sky-50 px-4 py-3 text-xs font-black text-brand-700">联系方式：{detail.contact}</p> : null}
        <AttachmentGrid attachments={detail.attachments || []} />
      </div>

      <div className="space-y-3">
        {(detail.replies || []).map((item) => (
          <div key={item.id} className={`rounded-2xl p-4 ${item.authorRole === 'ADMIN' ? 'bg-brand-50' : 'bg-sky-50/70'}`}>
            <div className="flex items-center gap-2 text-xs font-black text-slate-500">
              <Avatar user={item.author} />
              <span>{item.author.nickname}</span>
              <span>UID {String(item.author.uid).padStart(5, '0')}</span>
              <span>{item.authorRole === 'ADMIN' ? '管理员' : '用户'}</span>
              <span>{formatTime(item.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-700">{item.content}</p>
            <AttachmentGrid attachments={item.attachments} />
          </div>
        ))}
      </div>

      {!isClosed ? (
        <form onSubmit={submitReply} className="space-y-3">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} className="min-h-28 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none" placeholder="继续补充说明或回复管理员" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
              上传图片
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => upload(event, 'reply')} className="hidden" />
            </label>
            {replyAttachments.length ? <span className="text-xs font-bold text-slate-500">已上传 {replyAttachments.length} 张图片</span> : null}
            <button disabled={replying} className="rounded-full bg-brand-950 px-5 py-2 text-sm font-black text-white disabled:opacity-60">{replying ? '发送中...' : '发送回复'}</button>
            <button type="button" onClick={resolveFeedback} className="rounded-full bg-emerald-50 px-5 py-2 text-sm font-black text-emerald-700">标记已解决</button>
          </div>
        </form>
      ) : (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-500">该反馈已关闭，不能继续回复。</p>
      )}
    </div>
  )
}

function Avatar({ user }: { user: { nickname: string; avatarUrl?: string | null } }) {
  return (
    <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] text-white">
      {user.avatarUrl ? <img src={user.avatarUrl} alt={user.nickname} className="h-full w-full object-cover" /> : user.nickname.slice(0, 1)}
    </span>
  )
}

function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  const visible = attachments.filter((item) => item.url)
  if (!visible.length) return null
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {visible.map((item) => (
        <Link key={item.id || item.url} href={item.url} target="_blank" className="block overflow-hidden rounded-2xl bg-white">
          <img src={item.url} alt="反馈附件" className="h-28 w-full object-cover" />
        </Link>
      ))}
    </div>
  )
}
