'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LikeAvatars, type LikeAvatarUser } from '@/components/LikeAvatars'
import { SafeAvatar } from '@/components/SafeAvatar'
import { Pagination } from '@/components/ui/Pagination'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type WallSender = {
  uid: number
  nickname: string
  avatarUrl: string | null
  profile: { displayName: string | null; avatarUrl: string | null } | null
}

type WallMessage = {
  id: string
  parentId: string | null
  content: string
  createdAt: string
  updatedAt?: string
  canDelete: boolean
  liked: boolean
  likeCount: number
  likers?: LikeAvatarUser[]
  commentCount: number
  sender: WallSender
  children?: WallMessage[]
}

type WallPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasPrevious: boolean
  hasNext: boolean
}

const EMPTY_WALL_PAGINATION: WallPagination = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
}

function parseWallPage(value: string | null) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

function findWallMessage(messages: WallMessage[], id: string): WallMessage | null {
  for (const message of messages) {
    if (message.id === id) return message
    const child = findWallMessage(message.children || [], id)
    if (child) return child
  }
  return null
}

function findRootId(messages: WallMessage[], id: string): string | null {
  for (const root of messages) {
    if (root.id === id) return root.id
    if (findWallMessage(root.children || [], id)) return root.id
  }
  return null
}

function insertWallMessage(messages: WallMessage[], created: WallMessage) {
  if (!created.parentId) return { messages: [created, ...messages], inserted: true, rootId: created.id }

  let inserted = false
  const insert = (items: WallMessage[]): WallMessage[] => items.map((item) => {
    if (item.id === created.parentId) {
      inserted = true
      return { ...item, children: [...(item.children || []), created], commentCount: item.commentCount + 1 }
    }
    const children = insert(item.children || [])
    return children === (item.children || []) ? item : { ...item, children }
  })
  const nextMessages = insert(messages)
  const withCommentCounts = (items: WallMessage[]): WallMessage[] => items.map((item) => {
    const children = withCommentCounts(item.children || [])
    return {
      ...item,
      children,
      commentCount: children.reduce((total, child) => total + 1 + child.commentCount, 0),
    }
  })
  const normalizedMessages = withCommentCounts(nextMessages)
  return { messages: normalizedMessages, inserted, rootId: inserted ? findRootId(normalizedMessages, created.id) : null }
}

function flattenReplies(children: WallMessage[], parentName: string) {
  const flattened: Array<{ message: WallMessage; replyToName: string }> = []
  for (const child of children) {
    const childName = child.sender.profile?.displayName || child.sender.nickname
    flattened.push({ message: child, replyToName: parentName })
    flattened.push(...flattenReplies(child.children || [], childName))
  }
  return flattened
}

export function ProfileWall({ receiverUid, focusId, isOwner = false }: { receiverUid: number; focusId?: string; isOwner?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const wallRef = useRef<HTMLElement | null>(null)
  const wallPage = parseWallPage(searchParams.get('wallPage'))
  const [messages, setMessages] = useState<WallMessage[]>([])
  const [content, setContent] = useState('')
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [canPost, setCanPost] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [pagination, setPagination] = useState<WallPagination>(EMPTY_WALL_PAGINATION)

  const replaceWallPage = useCallback((nextPage: number, clearFocus = false) => {
    const safePage = Math.max(1, Math.trunc(nextPage) || 1)
    const params = new URLSearchParams(searchParams.toString())
    if (safePage === 1) params.delete('wallPage')
    else params.set('wallPage', String(safePage))
    if (clearFocus) params.delete('focus')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    wallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pathname, router, searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ receiverUid: String(receiverUid), wallPage: String(wallPage) })
      if (focusId) params.set('focusId', focusId)
      const response = await fetch(`/api/profile-wall?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '留言墙加载失败')
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setCanPost(Boolean(data.canPost))
      if (data.pagination) {
        setPagination(data.pagination as WallPagination)
        if (data.pagination.page !== wallPage) replaceWallPage(data.pagination.page)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '留言墙加载失败')
    } finally {
      setLoading(false)
    }
  }, [focusId, receiverUid, replaceWallPage, wallPage])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!focusId || loading) return
    const rootId = findRootId(messages, focusId)
    if (!rootId) {
      setError('该内容已被删除或无法查看')
      return
    }
    if (rootId !== focusId) setExpanded((current) => ({ ...current, [rootId]: true }))
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`wall-message-${focusId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.classList.add('notification-focus-target')
    })
    const timer = window.setTimeout(() => document.getElementById(`wall-message-${focusId}`)?.classList.remove('notification-focus-target'), 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusId, loading, messages])

  async function submit() {
    if (submitting || !content.trim()) return
    setSubmitting(true)
    setError('')
    const parentId = replyTo?.id || null
    try {
      const response = await fetch('/api/profile-wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverUid, content, parentId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '留言发布失败')
      const created = data.wallMessage as WallMessage | undefined
      setContent('')
      setReplyTo(null)
      if (!created?.id) {
        if (parentId || wallPage === 1) await load()
        else replaceWallPage(1)
      } else if (!created.parentId) {
        if (wallPage === 1) await load()
        else replaceWallPage(1)
      } else {
        setMessages((current) => {
          const result = insertWallMessage(current, created)
          if (result.inserted && result.rootId) setExpanded((expandedState) => ({ ...expandedState, [result.rootId!]: true }))
          return result.inserted ? result.messages : current
        })
      }
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

  async function toggleLike(messageId: string) {
    const response = await fetch(`/api/profile-wall/${messageId}/like`, { method: 'POST' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message || '点赞失败')
      return
    }
    const update = (items: WallMessage[]): WallMessage[] => items.map((item) => item.id === messageId
      ? { ...item, liked: Boolean(data.liked), likeCount: Number(data.likeCount) || 0 }
      : { ...item, children: update(item.children || []) })
    setMessages(update)
  }

  return (
    <section ref={wallRef} className="rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
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
              回复 @{replyTo.name}
              <button className="ml-2 underline" onClick={() => setReplyTo(null)} type="button">取消</button>
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
        {messages.map((message) => <WallMessageCard key={message.id} message={message} expanded={expanded} isOwner={isOwner} onToggleComments={(id) => setExpanded((value) => ({ ...value, [id]: !value[id] }))} onLike={toggleLike} onReply={setReplyTo} onDelete={remove} />)}
      </div>
      {pagination.totalPages > 1 ? (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={(nextPage) => replaceWallPage(nextPage, true)}
          disabled={loading || submitting}
          ariaLabel="留言墙分页"
          className="mt-4"
        />
      ) : null}
    </section>
  )
}

function WallMessageCard({ message, expanded, isOwner = false, onToggleComments, onLike, onReply, onDelete }: { message: WallMessage; expanded: Record<string, boolean>; isOwner?: boolean; onToggleComments: (id: string) => void; onLike: (id: string) => void; onReply: (target: { id: string; name: string }) => void; onDelete: (id: string) => void }) {
  const name = message.sender.profile?.displayName || message.sender.nickname
  const avatar = profileImageUrl(message.sender.profile?.avatarUrl || message.sender.avatarUrl)
  const children = message.children || []
  const replyCount = message.commentCount || children.length

  return (
    <article id={`wall-message-${message.id}`} className="scroll-mt-20 rounded-2xl border border-sky-100 bg-white p-3 shadow-sm">
      <div className="flex gap-3">
        <a href={`/user/${formatUid(message.sender.uid)}`} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50">
          <SafeAvatar src={avatar} name={name} uid={message.sender.uid} className="h-full w-full" />
        </a>
        <div className="min-w-0 flex-1">
          <WallMessageHeader message={message} name={name} />
          <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{message.content}</p>
          <WallMessageActions message={message} replyCount={replyCount} expanded={Boolean(expanded[message.id])} onToggleComments={onToggleComments} onLike={onLike} onReply={onReply} onDelete={onDelete} />
          {isOwner ? <LikeAvatars likers={message.likers || []} totalCount={message.likeCount} listUrl={`/api/profile-wall/${message.id}/like`} className="mt-1.5" /> : null}
          {children.length && expanded[message.id] ? (
            <div className="mt-3 space-y-2 border-l-2 border-sky-100 pl-3">
              {flattenReplies(children, name).map(({ message: child, replyToName }) => <WallReplyCard key={child.id} message={child} replyToName={replyToName} isOwner={isOwner} onLike={onLike} onReply={onReply} onDelete={onDelete} />)}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function WallMessageHeader({ message, name }: { message: WallMessage; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/user/${formatUid(message.sender.uid)}`} className="font-black text-brand-950">{name}</a>
      <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(message.sender.uid)}</span>
      <span className="text-xs font-bold text-slate-400">{new Date(message.createdAt).toLocaleString('zh-CN')}</span>
    </div>
  )
}

function WallMessageActions({ message, replyCount, expanded, onToggleComments, onLike, onReply, onDelete }: { message: WallMessage; replyCount: number; expanded: boolean; onToggleComments: (id: string) => void; onLike: (id: string) => void; onReply: (target: { id: string; name: string }) => void; onDelete: (id: string) => void }) {
  const name = message.sender.profile?.displayName || message.sender.nickname
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      <button onClick={() => void onLike(message.id)} className="text-xs font-black text-brand-700" type="button">{message.liked ? '取消点赞' : '点赞'} {message.likeCount}</button>
      {replyCount > 0 ? <button onClick={() => onToggleComments(message.id)} className="text-xs font-black text-brand-700" type="button">{expanded ? '收起回复' : `查看 ${replyCount} 条回复`}</button> : null}
      <button onClick={() => onReply({ id: message.id, name })} className="text-xs font-black text-brand-700" type="button">回复</button>
      {message.canDelete ? <button onClick={() => onDelete(message.id)} className="text-xs font-black text-red-600" type="button">删除</button> : null}
    </div>
  )
}

function WallReplyCard({ message, replyToName, isOwner, onLike, onReply, onDelete }: { message: WallMessage; replyToName: string; isOwner: boolean; onLike: (id: string) => void; onReply: (target: { id: string; name: string }) => void; onDelete: (id: string) => void }) {
  const name = message.sender.profile?.displayName || message.sender.nickname
  const avatar = profileImageUrl(message.sender.profile?.avatarUrl || message.sender.avatarUrl)
  return (
    <article id={`wall-message-${message.id}`} className="rounded-xl bg-sky-50/60 p-2.5">
      <div className="flex gap-2.5">
        <a href={`/user/${formatUid(message.sender.uid)}`} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
          <SafeAvatar src={avatar} name={name} uid={message.sender.uid} className="h-full w-full" />
        </a>
        <div className="min-w-0 flex-1">
          <WallMessageHeader message={message} name={name} />
          <p className="mt-1 text-xs font-bold text-brand-700">回复 @{replyToName}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{message.content}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button onClick={() => void onLike(message.id)} className="text-xs font-black text-brand-700" type="button">{message.liked ? '取消点赞' : '点赞'} {message.likeCount}</button>
            <button onClick={() => onReply({ id: message.id, name })} className="text-xs font-black text-brand-700" type="button">回复</button>
            {message.canDelete ? <button onClick={() => onDelete(message.id)} className="text-xs font-black text-red-600" type="button">删除</button> : null}
          </div>
          {isOwner ? <LikeAvatars likers={message.likers || []} totalCount={message.likeCount} listUrl={`/api/profile-wall/${message.id}/like`} className="mt-1.5" /> : null}
        </div>
      </div>
    </article>
  )
}
