'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ContentImageUploader, type ContentImageUploadState, type ContentImageUploaderHandle } from '@/components/ContentImageUploader'
import { FriendMentionInput, type MentionDraft } from '@/components/FriendMentionInput'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'
import { ReplyLengthCounter } from '@/components/ReplyLengthCounter'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getReplyLengthMetrics, replyMinimumContentError, replyTooLongMessage } from '@/lib/reply-length'
import { getReplyErrorMessage } from '@/lib/reply-errors'

export function ReplyForm({
  postId,
  replyTo,
  onReplyCancel,
  onReplyCreated,
  draftContent,
  onDraftChange,
  onDraftClear,
  beforeSubmit,
  allowImageAttachments = true,
  isTopicRootComment = false,
  autoFocus = false,
  className = '',
}: Readonly<{
  postId: string
  replyTo?: { id: string; name: string } | null
  onReplyCancel?: () => void
  onReplyCreated?: (reply: unknown) => void
  draftContent?: string
  onDraftChange?: (content: string) => void
  onDraftClear?: () => void
  beforeSubmit?: () => boolean | Promise<boolean>
  allowImageAttachments?: boolean
  isTopicRootComment?: boolean
  autoFocus?: boolean
  className?: string
}>) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageUploaderRef = useRef<ContentImageUploaderHandle>(null)
  const submittingRef = useRef(false)
  const mountedRef = useRef(false)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [localContent, setLocalContent] = useState('')
  const [mentions, setMentions] = useState<MentionDraft[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [imageUploadState, setImageUploadState] = useState<ContentImageUploadState>({ pendingCount: 0, failedCount: 0, blocked: false })
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const content = draftContent ?? localContent
  const contentLength = getReplyLengthMetrics(content)
  const isOverLimit = contentLength.exceededBy > 0

  function setContent(nextContent: string) {
    if (draftContent !== undefined && onDraftChange) onDraftChange(nextContent)
    else setLocalContent(nextContent)
  }

  useEffect(() => {
    if (!autoFocus) return
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus])

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
    const currentImageUploadState = imageUploaderRef.current?.getUploadState() || imageUploadState
    if (currentImageUploadState.blocked) {
      setError(currentImageUploadState.failedCount > 0
        ? '图片上传失败，请重试或删除失败图片后再发布。'
        : '图片尚未上传完成。')
      return
    }
    if (isOverLimit) {
      setError(replyTooLongMessage(contentLength))
      return
    }
    if (!allowImageAttachments && imageUrls.length) {
      setError('该活动不允许评论图片附件，请移除已选择的图片')
      return
    }
    const minimumError = replyMinimumContentError(content, imageUrls.length, Boolean(pendingSticker), isTopicRootComment && !replyTo ? '参与评论' : '回复内容')
    if (minimumError) {
      setError(minimumError)
      return
    }
    submittingRef.current = true
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      if (beforeSubmit && !(await beforeSubmit())) return
      if (!mountedRef.current) return
      const latestImageUploadState = imageUploaderRef.current?.getUploadState() || imageUploadState
      if (latestImageUploadState.blocked) {
        setError(latestImageUploadState.failedCount > 0
          ? '图片上传失败，请重试或删除失败图片后再发布。'
          : '图片尚未上传完成。')
        return
      }
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
        setError(getReplyErrorMessage(response.status, data))
        return
      }
      if (!data.success || !data.reply?.id || !data.reply?.author) {
        setError('回复已提交，但评论数据加载失败，请刷新评论区重试')
        return
      }
      onDraftClear?.()
      if (draftContent === undefined) setLocalContent('')
      setMentions([])
      setImageUrls([])
      setPendingSticker(null)
      setPickerOpen(false)
      onReplyCancel?.()
      onReplyCreated?.(data.reply)
      const weeklyRewardText = Array.isArray(data.weeklyMilestoneRewards)
        ? data.weeklyMilestoneRewards.filter((item: { reward?: unknown }) => Number.isSafeInteger(item?.reward) && Number(item.reward) > 0).map((item: { reward: number }) => `+${item.reward}`).join('、')
        : ''
      const commentSuccess = data.rewardPoints ? `评论成功，获得 +${data.rewardPoints} 挂号费` : '评论成功'
      setSuccess(weeklyRewardText ? `${commentSuccess}；本周里程碑奖励 ${weeklyRewardText} 挂号费` : commentSuccess)
      if (data.rewardPoints || weeklyRewardText) window.dispatchEvent(new CustomEvent('user:points-updated', { detail: { delta: data.rewardPoints, points: data.points } }))
      if (!onReplyCreated) {
        try {
          router.refresh()
        } catch {
          setError('评论刷新失败，请稍后重试')
        }
      }
    } catch {
      setError('网络连接失败，请重试')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submitReply} className={`post-reply-form rounded-xl border p-5 shadow-sm ${className}`}>
      {replyTo ? (
        <div className="post-reply-form-target mb-3 flex items-center justify-between rounded-xl px-4 py-2 text-sm font-black text-brand-700">
          <span>正在回复 {replyTo.name}</span>
          <button type="button" onClick={onReplyCancel} className="text-slate-500">取消</button>
        </div>
      ) : null}

      {pendingSticker ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand-100 bg-sky-50 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicImageVariantUrl(pendingSticker.url, 'thumb-sm') || pendingSticker.url} alt={pendingSticker.name || '表情'} className="h-10 w-10 rounded-lg bg-white object-contain" />
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
          canSubmitShortcut={!isSubmitting && !isOverLimit && !imageUploadState.blocked && (content.trim().length >= 2 || imageUrls.length > 0 || Boolean(pendingSticker))}
        />
      </label>
      {allowImageAttachments ? <div className="mt-3"><ContentImageUploader ref={imageUploaderRef} value={imageUrls} onChange={setImageUrls} onUploadStateChange={setImageUploadState} /></div> : imageUrls.length ? <button type="button" onClick={() => setImageUrls([])}>移除已选择的图片</button> : null}
      {imageUploadState.blocked ? <p role="status" className="mt-2 text-sm font-bold text-amber-700">{imageUploadState.failedCount > 0 ? '图片上传失败，请重试或删除失败图片后再发布。' : '图片尚未上传完成。'}</p> : null}
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
          <ReplyLengthCounter value={content} />
        </div>
        <button type="submit" disabled={isSubmitting || isOverLimit || imageUploadState.blocked} className="rounded-lg bg-brand-700 px-5 py-3 font-black text-white disabled:opacity-60">
          {isSubmitting ? '发布中...' : imageUploadState.failedCount > 0 ? '请处理失败图片' : imageUploadState.blocked ? '图片处理中…' : '发布回复'}
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
          variant="reply"
        />
      </div>
      {error ? <p role="alert" className="mt-2 text-sm font-bold text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm font-black text-emerald-600">{success}</p> : null}
    </form>
  )
}
