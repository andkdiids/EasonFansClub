'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

export const EMOJI_CATEGORIES = [
  {
    label: '常用表情',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🥰', '😍', '😘', '😎', '🤔', '🥹', '😭', '😢', '😡', '😱', '😴', '🙄', '😮', '🥲', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤭', '🫢', '🫣'],
  },
  {
    label: '爱心系列',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '🩷', '🩵', '🩶', '💕', '💖', '💗', '💓', '💞', '💘', '💝', '💟', '❣️', '❤️‍🔥', '❤️‍🩹', '💔', '💌'],
  },
  {
    label: '互动表情',
    emojis: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '👌', '✌️', '👀', '🔥', '🎉', '💯', '✨', '🤞', '🤟', '🤘', '👊', '✊', '🤛', '🤜', '👋', '🫶', '💪', '🫡', '🤙', '☝️', '👇', '👉', '👈', '👐'],
  },
  {
    label: '可爱动物',
    emojis: ['🐱', '🐶', '🐰', '🐻', '🐼', '🐸', '🦊', '🐨', '🐯', '🐷', '🐹', '🐭', '🐮', '🦁', '🐵', '🐧', '🐦', '🐥', '🦄', '🐝', '🦋', '🐢', '🐬', '🐳', '🦦'],
  },
  {
    label: '音乐与E院',
    emojis: ['🎵', '🎶', '🎤', '🎧', '⭐', '✨', '🌟', '🌙', '💫', '🚑', '💙', '🏥', '🩺', '💊', '🩹', '🎼', '🎹', '🥁', '🎸', '🎺', '🎻', '📻', '💿', '📀', '🎙️', '🎚️', '🎛️'],
  },
  {
    label: '网络常用',
    emojis: ['🥳', '🤩', '😆', '😅', '🤣', '🥲', '😇', '😜', '😝', '🤗', '🤓', '🧐', '🤪', '😏', '😬', '🫠', '🫥', '🫤', '🥺', '😤', '🤯', '🥶', '🥵', '🤤', '🤫', '🫨', '💀', '👻', '👽', '🤖', '💩', '🌈', '☀️', '☁️', '🍀'],
  },
] as const

export const EMOJI_COUNT = new Set(EMOJI_CATEGORIES.flatMap((category) => category.emojis)).size

type EmojiPickerProps = Readonly<{
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  maxLength?: number
  disabled?: boolean
}>

export function EmojiPicker({
  textareaRef,
  value,
  onChange,
  maxLength,
  disabled = false,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function insertEmoji(emoji: string) {
    const input = textareaRef.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    const candidate = `${value.slice(0, start)}${emoji}${value.slice(end)}`
    const next = typeof maxLength === 'number' ? candidate.slice(0, maxLength) : candidate
    const cursor = Math.min(start + emoji.length, next.length)
    onChange(next)
    setOpen(false)
    window.requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div ref={rootRef} className="emoji-picker">
      <button
        type="button"
        className="emoji-picker-trigger"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label="打开 Emoji 表情"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        😊
      </button>
      {open ? (
        <div className="emoji-picker-panel" role="dialog" aria-label={`Emoji 表情面板，共 ${EMOJI_COUNT} 个`}>
          {EMOJI_CATEGORIES.map((category) => (
            <section key={category.label} className="emoji-picker-category">
              <h3>{category.label}</h3>
              <div className="emoji-picker-grid">
                {category.emojis.map((emoji) => (
                  <button
                    key={`${category.label}-${emoji}`}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    aria-label={`插入 ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
