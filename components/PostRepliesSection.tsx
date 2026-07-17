'use client'

import Link from 'next/link'
import { useState } from 'react'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { ReplyForm } from '@/components/ReplyForm'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import { splitContentImages } from '@/lib/content-images'

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

function buildReplyMap(replies: ReplyItem[]) {
  return new Map(replies.map((reply) => [reply.id, reply]))
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
  const replyMap = buildReplyMap(replies)
  const rootReplies = tree.get(null) || []

  function addReply(reply: unknown) {
    if (!reply || typeof reply !== 'object') return
    setReplies((current) => [...current, reply as ReplyItem])
  }

  function removeReply(replyId: string) {
    setReplies((current) => {
      const byParent = buildReplyTree(current)
      const collectIds = (parentId: string): string[] => (byParent.get(parentId) || []).flatMap((reply) => [reply.id, ...collectIds(reply.id)])
      const removeIds = new Set([replyId, ...collectIds(replyId)])
      return current.filter((reply) => !removeIds.has(reply.id))
    })
  }

  function collectThreadReplies(rootId: string) {
    const result: Array<{ reply: ReplyItem; replyToName: string }> = []
    const visit = (parentId: string) => {
      const parent = replyMap.get(parentId)
      const parentName = parent ? parent.author.profile?.displayName || parent.author.nickname : ''
      ;(tree.get(parentId) || []).forEach((child) => {
        result.push({ reply: child, replyToName: parentName })
        visit(child.id)
      })
    }
    visit(rootId)
    return result
  }

  function renderCompactReply(item: { reply: ReplyItem; replyToName: string }) {
    const { reply, replyToName } = item
    const name = reply.author.profile?.displayName || reply.author.nickname
    const avatar = publicImageUrl(reply.author.profile?.avatarUrl || reply.author.avatarUrl)
    const canDelete = currentUserId === reply.author.id || isAdminRole(currentUserRole)
    const replyBody = splitContentImages(reply.content)

    return (
      <div key={reply.id} className="min-w-0 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <Link href={`/user/${formatUid(reply.author.uid)}`} className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white">
            {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Link href={`/user/${formatUid(reply.author.uid)}`} className="font-black text-brand-950">{name}</Link>
              <span className="font-bold text-slate-400">UID {formatUid(reply.author.uid)}</span>
              <span className="font-bold text-slate-400">Lv.{reply.author.level}</span>
              <span className="font-bold text-slate-400">{formatDate(new Date(reply.createdAt))}</span>
            </div>
            <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {replyToName ? <span className="font-black text-brand-700">回复 @{replyToName}：</span> : null}
              {replyBody.text}
            </p>
            {replyBody.images.length ? <div className="mt-2 grid grid-cols-2 gap-2">{replyBody.images.map((url) => <img key={url} src={url} alt="回复图片" className="max-h-48 w-full rounded-xl object-cover" />)}</div> : null}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {currentUserId ? (
                <button
                  type="button"
                  onClick={() => setReplyTo({ id: reply.id, name })}
                  className="text-xs font-black text-brand-700"
                >
                  回复
                </button>
              ) : null}
              {canDelete ? (
                <DeleteCommentButton endpoint={`/api/replies/${reply.id}`} label="删除" variant="text" onDeleted={() => removeReply(reply.id)} />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderReply(reply: ReplyItem, index: number) {
    const name = reply.author.profile?.displayName || reply.author.nickname
    const avatar = publicImageUrl(reply.author.profile?.avatarUrl || reply.author.avatarUrl)
    const children = collectThreadReplies(reply.id)
    const showAll = Boolean(expandedReplies[reply.id])
    const visibleChildren = showAll ? children : children.slice(0, 3)
    const canDelete = currentUserId === reply.author.id || isAdminRole(currentUserRole)
    const replyBody = splitContentImages(reply.content)

    return (
      <article key={reply.id}>
        <div className="rounded-xl border border-sky-100 bg-white/82 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm font-bold text-slate-500">
            <Link href={`/user/${formatUid(reply.author.uid)}`} className="flex items-center gap-2 text-brand-950">
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
              </span>
              <span>{name} · UID {formatUid(reply.author.uid)} · Lv.{reply.author.level}</span>
            </Link>
            <span>#{index + 1} · {formatDate(new Date(reply.createdAt))}</span>
          </div>
          <p className="whitespace-pre-wrap leading-7 text-slate-700">
            {replyBody.text}
          </p>
          {replyBody.images.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{replyBody.images.map((url) => <img key={url} src={url} alt="回复图片" className="max-h-72 w-full rounded-xl object-cover" />)}</div> : null}
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
          <div className="mt-2 ml-3 space-y-1 border-l-2 border-sky-100 pl-3 sm:ml-4 sm:pl-4">
            {visibleChildren.map((child) => renderCompactReply(child))}
            {children.length > 3 ? (
              <button
                type="button"
                onClick={() => setExpandedReplies((current) => ({ ...current, [reply.id]: !showAll }))}
                className="py-1 text-xs font-black text-brand-700"
              >
                {showAll ? '收起回复' : `展开剩余 ${children.length - 3} 条回复`}
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
