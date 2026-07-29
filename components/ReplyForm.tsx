'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { EmojiButton } from '@/components/EmojiPicker'
import { ContentImageUploader } from '@/components/ContentImageUploader'

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
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
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

  async function submitReply(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/posts/${postId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parentId: replyTo?.id, imageUrls }),
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
      setImageUrls([])
      onReplyCancel?.()
      onReplyCreated?.(data.reply)
      setSuccess(data.rewardPoints === 3 ? '评论成功，获得 +3 积分' : '评论成功')
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
    <form onSubmit={submitReply} className="rounded-xl border border-sky-100 bg-white/82 p-5 shadow-sm">
      {replyTo ? (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
          <span>正在回复 {replyTo.name}</span>
          <button type="button" onClick={onReplyCancel} className="text-slate-500">取消</button>
        </div>
      ) : null}
      <label className="block">
        <span className="text-sm font-black text-slate-700">{replyTo ? '楼中楼回复' : '回复帖子'}</span>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitReply()
            }
          }}
          rows={5}
          className="mt-3 w-full rounded-lg border border-sky-100 px-4 py-2 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="写下你的回复..."
        />
      </label>
      <div className="mt-3"><ContentImageUploader value={imageUrls} onChange={setImageUrls} /></div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <EmojiButton onSelect={insertEmoji} />
        <button disabled={isSubmitting} className="rounded-lg bg-brand-700 px-5 py-3 font-black text-white disabled:opacity-60">
          {isSubmitting ? '发布中...' : '发布回复'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm font-bold text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm font-black text-emerald-600">{success}</p> : null}
    </form>
  )
}
