'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { ContentImageUploader } from '@/components/ContentImageUploader'
import { FriendMentionInput, type MentionDraft } from '@/components/FriendMentionInput'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'

export function ReplyForm({
  postId,
  replyTo,
  onReplyCancel,
  onReplyCreated,
}: Readonly<{
  postId: string
  replyTo?: { id: string; name: string } | null
  onReplyCancel?: () => void
  onReplyCreated?: (reply: unknown) => void
}>) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)
  const [content, setContent] = useState('')
  const [mentions, setMentions] = useState<MentionDraft[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 统一表情面板选中系统 emoji 时，在当前光标处插入并恢复焦点
  function insertEmoji(emoji: string) {
    const input = textareaRef.current
    const start = input?.selectionStart ?? content.length
    const end = input?.selectionEnd ?? content.length
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`
    const cursor = Math.min(start + emoji.length, next.length)
    setContent(next)
    window.requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(cursor, cursor)
    })
  }

  async function submitReply(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submittingRef.current) return
    if (!content.trim() && imageUrls.length === 0 && !pendingSticker) {
      setError('回复内容不能为空')
      return
    }
    submittingRef.current = true
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/posts/${postId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          parentId: replyTo?.id,
          imageUrls,
          mentions,
          stickerId: pendingSticker?.id || undefined,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || data.errors?.content || '回复失败')
        return
      }
      if (!data.success || !data.reply?.id || !data.reply?.author) {
        setError('回复已提交，但评论数据加载失败，请刷新评论区重试')
        return
      }
      setContent('')
      setMentions([])
      setImageUrls([])
      setPendingSticker(null)
      setPickerOpen(false)
      onReplyCancel?.()
      onReplyCreated?.(data.reply)
      setSuccess(data.rewardPoints ? `评论成功，获得 +${data.rewardPoints} 挂号费` : '评论成功')
      if (data.rewardPoints) window.dispatchEvent(new CustomEvent('user:points-updated', { detail: { delta: data.rewardPoints } }))
      if (!onReplyCreated) {
        try {
          router.refresh()
        } catch {
          setError('评论刷新失败，请稍后重试')
        }
      }
    } catch {
      setError('网络异常，无法确认回复状态，请刷新评论区后再试')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submitReply} className="post-reply-form rounded-xl border p-5 shadow-sm">
      {replyTo ? (
        <div className="post-reply-form-target mb-3 flex items-center justify-between rounded-xl px-4 py-2 text-sm font-black text-brand-700">
          <span>正在回复 {replyTo.name}</span>
          <button type="button" onClick={onReplyCancel} className="text-slate-500">取消</button>
        </div>
      ) : null}

      {pendingSticker ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand-100 bg-sky-50 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingSticker.url} alt={pendingSticker.name || '表情'} className="h-10 w-10 rounded-lg bg-white object-contain" />
          <span className="text-sm font-bold text-slate-600">已选择表情，点击发布发送</span>
          <button type="button" onClick={() => setPendingSticker(null)} className="ml-auto text-sm font-black text-slate-400 hover:text-red-500">移除</button>
        </div>
      ) : null}

      <label className="block">
        <span className="text-sm font-black text-slate-700">{replyTo ? '楼中楼回复' : '回复帖子'}</span>
        <FriendMentionInput
          textareaRef={textareaRef}
          value={content}
          mentions={mentions}
          onChange={setContent}
          onMentionsChange={setMentions}
          onSubmitShortcut={() => void submitReply()}
        />
      </label>
      <div className="mt-3"><ContentImageUploader value={imageUrls} onChange={setImageUrls} /></div>
      <div className="relative mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPickerOpen((value) => !value)}
            className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
            aria-label="选择表情包"
            aria-expanded={pickerOpen}
          >
            😊 表情
          </button>
        </div>
        <button disabled={isSubmitting} className="rounded-lg bg-brand-700 px-5 py-3 font-black text-white disabled:opacity-60">
          {isSubmitting ? '发布中...' : '发布回复'}
        </button>
        <StickerPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelectSticker={(sticker) => {
            setPendingSticker(sticker)
            setPickerOpen(false)
          }}
          onSelectEmoji={insertEmoji}
          composerRef={textareaRef}
        />
      </div>
      {error ? <p className="mt-2 text-sm font-bold text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm font-black text-emerald-600">{success}</p> : null}
    </form>
  )
}
