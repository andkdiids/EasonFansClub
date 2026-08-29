'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { ContentImageUploader } from '@/components/ContentImageUploader'
import { EmojiPicker } from '@/components/EmojiPicker'
import { FriendMentionInput, type MentionDraft } from '@/components/FriendMentionInput'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { shouldSubmitCommentOnEnter } from '@/lib/comment-keyboard'
import { useIsDesktopMediaQuery } from '@/lib/use-desktop-media-query'

export type NotificationReplyPayload = {
  content: string
  mentions: MentionDraft[]
  imageUrls: string[]
  stickerId?: string
}

export function NotificationReplyComposer({
  actorName,
  initialContent = '',
  maxLength = 2000,
  rich = false,
  submitting = false,
  disabled = false,
  onDraftChange,
  onCancel,
  onSubmit,
}: Readonly<{
  actorName?: string | null
  initialContent?: string
  maxLength?: number
  /** Post replies use the same mention/image/sticker controls as the detail page. */
  rich?: boolean
  submitting?: boolean
  disabled?: boolean
  onDraftChange?: (content: string) => void
  onCancel: () => void
  onSubmit: (payload: NotificationReplyPayload) => Promise<void> | void
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState(initialContent)
  const [mentions, setMentions] = useState<MentionDraft[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const isDisabled = disabled || submitting
  const isDesktop = useIsDesktopMediaQuery()
  const canSubmitShortcut = !isDisabled && (content.trim().length > 0 || imageUrls.length > 0 || Boolean(pendingSticker))

  function updateContent(next: string) {
    setContent(next)
    onDraftChange?.(next)
  }

  function insertEmoji(emoji: string) {
    const input = textareaRef.current
    const start = input?.selectionStart ?? content.length
    const end = input?.selectionEnd ?? content.length
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`.slice(0, maxLength)
    const cursor = Math.min(start + emoji.length, next.length)
    updateContent(next)
    window.requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(cursor, cursor)
    })
  }

  async function submit() {
    if (isDisabled) return
    if (!content.trim() && imageUrls.length === 0 && !pendingSticker) {
      setError('回复内容不能为空')
      return
    }
    setError('')
    await onSubmit({
      content,
      mentions,
      imageUrls,
      stickerId: pendingSticker?.id,
    })
  }

  return (
    <div
      className="notification-reply-editor mt-2 min-w-0 max-w-full overflow-x-hidden rounded-sm border border-sky-100 bg-white p-3 sm:p-4"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="text-xs font-black text-brand-700">回复 @{actorName || '对方'}</p>

      {rich && pendingSticker ? (
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-sm border border-sky-100 bg-sky-50 px-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicImageVariantUrl(pendingSticker.url, 'thumb-sm') || pendingSticker.url} alt={pendingSticker.name || '表情'} className="h-9 w-9 shrink-0 rounded bg-white object-contain" />
          <span className="min-w-0 truncate text-xs font-bold text-slate-600">已选择表情，发送后作为本条回复的一部分</span>
          <button type="button" onClick={() => setPendingSticker(null)} className="ml-auto shrink-0 text-xs font-black text-slate-400 hover:text-red-500">移除</button>
        </div>
      ) : null}

      {rich ? (
        <FriendMentionInput
          textareaRef={textareaRef}
          value={content}
          mentions={mentions}
          onChange={updateContent}
          onMentionsChange={setMentions}
          onSubmitShortcut={() => void submit()}
          canSubmitShortcut={canSubmitShortcut}
          maxLength={maxLength}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          maxLength={maxLength}
          onChange={(event) => updateContent(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!shouldSubmitCommentOnEnter(event, { isDesktop, canSubmit: canSubmitShortcut })) return
            event.preventDefault()
            void submit()
          }}
          className="mt-2 min-h-20 w-full min-w-0 max-w-full box-border resize-y rounded-sm border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-4 focus:ring-brand-500/20"
          placeholder="写下你的回复…"
        />
      )}

      {rich ? <div className="mt-2 min-w-0 max-w-full"><ContentImageUploader value={imageUrls} onChange={setImageUrls} /></div> : null}

      <div className="relative mt-2 flex w-full min-w-0 max-w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {rich ? (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setPickerOpen((value) => !value)}
              className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-1 rounded-sm border border-sky-100 px-2.5 text-xs font-black text-slate-600 hover:bg-sky-50"
              aria-label="选择表情包"
              aria-expanded={pickerOpen}
            >
              😊 表情
            </button>
          ) : (
            <EmojiPicker
              textareaRef={textareaRef}
              value={content}
              onChange={updateContent}
              maxLength={maxLength}
              disabled={isDisabled}
              triggerLabel="选择 Emoji 表情"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-9 rounded-sm border border-sky-100 px-3 text-xs font-black text-slate-600">取消</button>
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => void submit()}
            className="min-h-9 max-w-full rounded-sm bg-brand-950 px-3 text-xs font-black text-white disabled:opacity-50"
          >
            {isDisabled ? '发送中…' : '发送'}
          </button>
        </div>
        {rich ? (
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
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs font-black text-red-600">{error}</p> : null}
    </div>
  )
}
