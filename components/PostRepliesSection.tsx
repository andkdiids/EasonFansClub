'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { ReplyForm } from '@/components/ReplyForm'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type ReplyItem = {
  id: string
  content: string
  parentId: string | null
  createdAt: Date | string
  author: {
    id: string
    uid: number
    nickname: string
    level: number
    avatarUrl?: string | null
    profile?: { displayName: string | null; avatarUrl: string | null } | null
  }
}

function isAdminRole(role?: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

function buildReplyTree(replies: ReplyItem[]) {
  const byParent = new Map<string | null, ReplyItem[]>()
  replies.forEach((reply) => {
    const key = reply.parentId || null
    byParent.set(key, [...(byParent.get(key) || []), reply])
  })
  return byParent
}

export function PostRepliesSection({
  postId,
  initialReplies,
  initialReplyCount,
  currentUserId,
  currentUserRole,
}: Readonly<{
  postId: string
  initialReplies: ReplyItem[]
  initialReplyCount: number
  currentUserId?: string
  currentUserRole?: string
}>) {
  const [replies, setReplies] = useState(initialReplies)
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null)
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const tree = buildReplyTree(replies)
  const rootReplies = tree.get(null) || []

  function addReply(reply: unknown) {
    if (!reply || typeof reply !== 'object') return
    setReplies((current) => [...current, reply as ReplyItem])
  }

  function removeReply(replyId: string) {
    setReplies((current) => current.filter((reply) => reply.id !== replyId && reply.parentId !== replyId))
  }

  function renderReply(reply: ReplyItem, index: number, depth = 0, replyToName?: string) {
    const name = reply.author.profile?.displayName || reply.author.nickname
    const avatar = publicImageUrl(reply.author.profile?.avatarUrl || reply.author.avatarUrl)
    const children = tree.get(reply.id) || []
    const showAll = Boolean(expandedReplies[reply.id])
    const visibleChildren = showAll ? children : children.slice(0, 3)
    const canDelete = currentUserId === reply.author.id || isAdminRole(currentUserRole)

    return (
      <article key={reply.id} className={`${depth ? 'border-l-2 border-sky-100 pl-4' : ''}`}>
        <div className="rounded-xl border border-sky-100 bg-white/82 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm font-bold text-slate-500">
            <Link href={`/user/${formatUid(reply.author.uid)}`} className="flex items-center gap-2 text-brand-950">
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
              </span>
              <span>{name} · UID {formatUid(reply.author.uid)} · Lv.{reply.author.level}</span>
            </Link>
            <span>{depth ? '回复' : `#${index + 1}`} · {formatDate(new Date(reply.createdAt))}</span>
          </div>
          <p className="whitespace-pre-wrap leading-7 text-slate-700">
            {replyToName ? <span className="font-black text-brand-700">回复 {replyToName}：</span> : null}
            {reply.content}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {currentUserId ? (
              <button
                type="button"
                onClick={() => setReplyTo({ id: reply.id, name })}
                className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700"
              >
                回复
              </button>
            ) : null}
            {canDelete ? (
              <DeleteCommentButton endpoint={`/api/replies/${reply.id}`} onDeleted={() => removeReply(reply.id)} />
            ) : null}
          </div>
        </div>
        {visibleChildren.length ? (
          <div className="mt-3 space-y-3 pl-3">
            {visibleChildren.map((child, childIndex) => renderReply(child, childIndex, depth + 1, name))}
            {children.length > 3 ? (
              <button
                type="button"
                onClick={() => setExpandedReplies((current) => ({ ...current, [reply.id]: !showAll }))}
                className="text-xs font-black text-brand-700"
              >
                {showAll ? '收起回复' : `展开更多回复（${children.length - 3}）`}
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-black text-brand-950">回复 {Math.max(initialReplyCount, replies.length)}</h2>
      {rootReplies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sky-200 bg-white/65 p-8 text-center text-slate-500">还没有回复。</div>
      ) : (
        <div className="space-y-3">
          {rootReplies.map((reply, index) => renderReply(reply, index))}
        </div>
      )}

      {currentUserId ? (
        <ReplyForm
          postId={postId}
          replyTo={replyTo}
          onReplyCancel={() => setReplyTo(null)}
          onReplyCreated={addReply}
        />
      ) : (
        <div className="rounded-xl border border-sky-100 bg-white/82 p-5 text-center font-bold text-slate-600">请先登录后再回复。</div>
      )}
    </section>
  )
}
