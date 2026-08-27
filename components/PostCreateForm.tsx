'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { ContentImageUploader } from '@/components/ContentImageUploader'
import { RichTextEditor, type RichTextEditorHandle } from '@/components/posts/RichTextEditor'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'
import { publicImageVariantUrl } from '@/lib/image-variants'
import type { RichTextContent } from '@/lib/rich-text'

type Board = { id: string; name: string; slug: string }

export function PostCreateForm({ boards, initialBoardSlug }: Readonly<{ boards: Board[]; initialBoardSlug?: string }>) {
  const router = useRouter()
  const editorRef = useRef<RichTextEditorHandle>(null)
  const [boardId, setBoardId] = useState(boards.find((board) => board.slug === initialBoardSlug)?.id || boards[0]?.id || '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [richContent, setRichContent] = useState<RichTextContent | null>(null)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setErrors({})
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, title, content, richContent, imageUrls, stickerId: pendingSticker?.id || undefined }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrors({ form: typeof data?.message === 'string' ? data.message : '发布帖子暂时失败，请稍后重试', ...data?.errors })
        return
      }
      const postId = typeof data?.post?.id === 'string' ? data.post.id : ''
      const isPending = data?.moderationStatus === 'PENDING' || data?.post?.moderationStatus === 'PENDING'
      if (!postId) {
        console.error('[post:create:invalid-response]', { hasPost: Boolean(data?.post), status: data?.moderationStatus })
        setErrors({ form: '帖子已提交，但跳转地址异常，请刷新帖子列表查看。' })
        return
      }
      if (isPending) {
        router.push(`/post/submitted?postId=${postId}&status=${data.moderationStatus}`)
      } else {
        const detailUrl = typeof data?.detailUrl === 'string' ? data.detailUrl : `/posts/${postId}`
        router.push(detailUrl)
      }
      router.refresh()
    } catch (error) {
      console.error('[post:create:request]', {
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message : String(error),
      })
      setErrors({ form: '网络连接失败，请检查网络后重试' })
    } finally {
      setIsSubmitting(false)
    }
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
        <div className="mt-2">
          <RichTextEditor
            ref={editorRef}
            onChange={(nextRichContent, plainText) => {
              setRichContent(nextRichContent)
              setContent(plainText)
            }}
          />
        </div>
        {errors.content ? <p className="mt-2 text-sm font-bold text-red-600">{errors.content}</p> : null}
      </label>
      {pendingSticker ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand-100 bg-sky-50 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicImageVariantUrl(pendingSticker.url, 'thumb-sm') || pendingSticker.url} alt={pendingSticker.name || '表情'} className="h-10 w-10 rounded-lg bg-white object-contain" />
          <span className="text-sm font-bold text-slate-600">已选择表情，点击发布发送</span>
          <button type="button" onClick={() => setPendingSticker(null)} className="ml-auto text-sm font-black text-slate-400 hover:text-red-500">移除</button>
        </div>
      ) : null}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPickerOpen((value) => !value)}
            className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
            aria-label="选择表情"
            aria-expanded={pickerOpen}
          >
            😊 表情
          </button>
        </div>
        <button disabled={isSubmitting} className="rounded-lg bg-brand-700 px-5 py-3 font-black text-white disabled:opacity-60">
          {isSubmitting ? '发布中...' : '发布帖子'}
        </button>
        <StickerPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelectSticker={(sticker) => {
            setPendingSticker(sticker)
            setPickerOpen(false)
          }}
          onSelectEmoji={(emoji) => editorRef.current?.insertText(emoji)}
        />
      </div>
    </form>
  )
}
