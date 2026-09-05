'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FriendMentionInput, type MentionDraft } from '@/components/FriendMentionInput'
import { confirmSessionForAction } from '@/lib/client-auth'
import { getReplyLengthMetrics, replyTooLongMessage } from '@/lib/reply-length'

export type FishModeReplyPayload = {
  id: string
  content: string
  parentId: string | null
  createdAt: string
  updatedAt?: string
  author?: unknown
  [key: string]: unknown
}

/**
 * 摸鱼模式的轻量评论输入层。
 *
 * 业务仍然只走 /api/posts/:postId/replies；这里仅负责紧凑输入、键盘交互
 * 和把现有好友提及草稿传给同一个评论接口。
 */
export function FishModeCommentComposer({
  postId,
  parentId = null,
  replyToName,
  autoFocus = true,
  onCancel,
  onSubmitted,
}: Readonly<{
  postId: string
  parentId?: string | null
  replyToName?: string | null
  autoFocus?: boolean
  onCancel?: () => void
  onSubmitted?: (reply: FishModeReplyPayload) => void
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)
  const [content, setContent] = useState('')
  const [mentions, setMentions] = useState<MentionDraft[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const contentLength = getReplyLengthMetrics(content)
  const canSubmit = contentLength.actualLength >= 2 && contentLength.exceededBy === 0 && !isSubmitting

  useEffect(() => {
    if (!autoFocus) return
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus])

  function updateContent(value: string) {
    setContent(value)
    setError('')
    setSuccess('')
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submittingRef.current) return
    if (contentLength.exceededBy > 0) {
      setError(replyTooLongMessage(contentLength))
      return
    }
    if (contentLength.actualLength < 2) {
      if (content.trim()) setError('回复内容至少需要 2 个字符')
      return
    }

    const confirmed = await confirmSessionForAction('/forum/discovery/reply')
    if (!confirmed) return

    submittingRef.current = true
    setIsSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          parentId: parentId || undefined,
          mentions,
        }),
      })
      const data = await response.json().catch(() => ({})) as { success?: boolean; reply?: FishModeReplyPayload; message?: string; errors?: { content?: string } }
      if (!response.ok) {
        setError(typeof data.message === 'string' ? data.message : data.errors?.content || '发送失败，请重试')
        return
      }
      if (!data.success || !data.reply?.id) {
        setError('发送失败，请重试')
        return
      }
      setContent('')
      setMentions([])
      setSuccess('已评论')
      onSubmitted?.(data.reply)
    } catch {
      setError('发送失败，请重试')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <form className="fish-mode-inline-composer" data-fish-mode-comment-composer onSubmit={(event) => void submit(event)}>
      {replyToName ? <span className="fish-mode-inline-composer-target">回复 {replyToName}：</span> : null}
      <FriendMentionInput
        textareaRef={textareaRef}
        value={content}
        mentions={mentions}
        onChange={updateContent}
        onMentionsChange={setMentions}
        onSubmitShortcut={() => void submit()}
        canSubmitShortcut={canSubmit}
        rows={1}
        placeholder="说点什么…"
        rootClassName="fish-mode-inline-composer-input"
        textareaClassName="fish-mode-inline-composer-textarea"
        onEscape={onCancel}
      />
      <button type="submit" className="fish-mode-inline-composer-submit" disabled={!canSubmit}>
        {isSubmitting ? '发送中…' : '发送'}
      </button>
      {onCancel ? <button type="button" className="fish-mode-inline-composer-cancel" onClick={onCancel} disabled={isSubmitting}>取消</button> : null}
      {error ? <span className="fish-mode-inline-composer-message is-error" role="alert">{error}</span> : null}
      {success ? <span className="fish-mode-inline-composer-message is-success" role="status">{success}</span> : null}
    </form>
  )
}
