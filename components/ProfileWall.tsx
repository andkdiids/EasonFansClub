'use client'

import { useCallback, useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type WallSender = {
  uid: number
  nickname: string
  avatarUrl: string | null
  profile: { displayName: string | null; avatarUrl: string | null } | null
}

type WallMessage = {
  id: string
  content: string
  createdAt: string
  canDelete: boolean
  sender: WallSender
  children?: WallMessage[]
}

export function ProfileWall({ receiverUid }: { receiverUid: number }) {
  const [messages, setMessages] = useState<WallMessage[]>([])
  const [content, setContent] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [canPost, setCanPost] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/profile-wall?receiverUid=${receiverUid}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '留言墙加载失败')
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setCanPost(Boolean(data.canPost))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '留言墙加载失败')
    } finally {
      setLoading(false)
    }
  }, [receiverUid])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    if (submitting || !content.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/profile-wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverUid, content, parentId: replyTo }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '留言发布失败')
      setContent('')
      setReplyTo(null)
      await load()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '留言发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(messageId: string) {
    const response = await fetch(`/api/profile-wall/${messageId}`, { method: 'DELETE' })
    if (response.ok) await load()
  }

  return (
    <section className="rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">留言墙</p>
          <h2 className="mt-1 text-2xl font-black text-brand-950">个人留言墙</h2>
        </div>
      </div>

      {canPost ? (
        <div className="mt-4 rounded-2xl bg-sky-50/75 p-3">
          {replyTo ? (
            <p className="mb-2 text-xs font-black text-brand-700">
              正在回复一条留言
              <button className="ml-2 underline" onClick={() => setReplyTo(null)} type="button">
                取消
              </button>
            </p>
          ) : null}
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, 500))}
            className="min-h-20 w-full resize-none rounded-2xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold leading-6 outline-none"
            placeholder="留下你的留言..."
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-400">{content.length}/500</span>
            <button onClick={submit} disabled={submitting || !content.trim()} className="rounded-full bg-brand-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50" type="button">
              {submitting ? '发布中...' : '发布'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}
      {loading ? <p className="mt-4 rounded-2xl bg-sky-50 p-6 text-center text-sm font-black text-slate-500">留言墙加载中...</p> : null}
      {!loading && !messages.length ? <p className="mt-4 rounded-2xl bg-sky-50 p-6 text-center text-sm font-black text-slate-500">暂无留言</p> : null}

      <div className="mt-4 space-y-3">
        {messages.map((message) => <WallMessageCard key={message.id} message={message} onReply={setReplyTo} onDelete={remove} />)}
      </div>
    </section>
  )
}

function WallMessageCard({ message, onReply, onDelete }: { message: WallMessage; onReply: (id: string) => void; onDelete: (id: string) => void }) {
  const name = message.sender.profile?.displayName || message.sender.nickname
  const avatar = publicImageUrl(message.sender.profile?.avatarUrl || message.sender.avatarUrl)
  const children = message.children || []

  return (
    <article className="rounded-2xl border border-sky-100 bg-white p-3 shadow-sm">
      <div className="flex gap-3">
        <a href={`/user/${formatUid(message.sender.uid)}`} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50">
          <SafeAvatar src={avatar} name={name} className="h-full w-full" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/user/${formatUid(message.sender.uid)}`} className="font-black text-brand-950">{name}</a>
            <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(message.sender.uid)}</span>
            <span className="text-xs font-bold text-slate-400">{new Date(message.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{message.content}</p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => onReply(message.id)} className="text-xs font-black text-brand-700" type="button">回复</button>
            {message.canDelete ? <button onClick={() => onDelete(message.id)} className="text-xs font-black text-red-600" type="button">删除</button> : null}
          </div>
          {children.length ? (
            <div className="mt-3 space-y-2 border-l-2 border-sky-100 pl-3">
              {children.map((child) => <WallMessageCard key={child.id} message={child} onReply={onReply} onDelete={onDelete} />)}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
