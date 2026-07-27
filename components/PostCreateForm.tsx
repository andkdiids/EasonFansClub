'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { EmojiButton } from '@/components/EmojiPicker'
import { ContentImageUploader } from '@/components/ContentImageUploader'

type Board = { id: string; name: string; slug: string }

export function PostCreateForm({ boards, initialBoardSlug }: Readonly<{ boards: Board[]; initialBoardSlug?: string }>) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [boardId, setBoardId] = useState(boards.find((board) => board.slug === initialBoardSlug)?.id || boards[0]?.id || '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  function insertEmoji(emoji: string) {
    const input = textareaRef.current
    const start = input?.selectionStart ?? content.length
    const end = input?.selectionEnd ?? content.length
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`
    setContent(next)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setIsSubmitting(true)
    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, title, content, imageUrls }),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)
    if (!response.ok) {
      setErrors({ form: data.message, ...data.errors })
      return
    }
    const postId = typeof data?.post?.id === 'string' ? data.post.id : ''
    const detailUrl = typeof data?.detailUrl === 'string' ? data.detailUrl : postId ? `/posts/${postId}` : ''
    if (!postId || !detailUrl) {
      console.error('[post:create:invalid-response]', data)
      setErrors({ form: '帖子已提交，但跳转地址异常，请刷新帖子列表查看。' })
      return
    }
    console.info('[post:create:navigate]', { postId, detailUrl })
    if (data.rewardPoints) window.dispatchEvent(new CustomEvent('user:points-updated', { detail: { delta: data.rewardPoints } }))
    router.push(detailUrl)
    router.refresh()
  }

  return (
    <form onSubmit={submitPost} className="space-y-5 rounded-xl border border-sky-100 bg-white/82 p-6 shadow-sm">
      {errors.form ? <p className="text-sm font-bold text-red-600">{errors.form}</p> : null}
      <label className="block">
        <span className="text-sm font-black text-slate-700">选择板块</span>
        <select value={boardId} onChange={(event) => setBoardId(event.target.value)} className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2">
          {boards.map((board) => (
            <option key={board.id} value={board.id}>{board.name}</option>
          ))}
        </select>
        {errors.boardId ? <p className="mt-2 text-sm font-bold text-red-600">{errors.boardId}</p> : null}
      </label>
      <ContentImageUploader value={imageUrls} onChange={setImageUrls} />
      <label className="block">
        <span className="text-sm font-black text-slate-700">标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2" placeholder="请输入帖子标题" />
        {errors.title ? <p className="mt-2 text-sm font-bold text-red-600">{errors.title}</p> : null}
      </label>
      <label className="block">
        <span className="text-sm font-black text-slate-700">正文</span>
        <textarea ref={textareaRef} value={content} onChange={(event) => setContent(event.target.value)} rows={10} className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2" placeholder="分享你的想法..." />
        {errors.content ? <p className="mt-2 text-sm font-bold text-red-600">{errors.content}</p> : null}
      </label>
      <div className="flex items-center justify-between gap-3">
        <EmojiButton onSelect={insertEmoji} />
        <button disabled={isSubmitting} className="rounded-lg bg-brand-700 px-5 py-3 font-black text-white disabled:opacity-60">
          {isSubmitting ? '发布中...' : '发布帖子'}
        </button>
      </div>
    </form>
  )
}
