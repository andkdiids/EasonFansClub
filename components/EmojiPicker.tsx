'use client'

import { useState } from 'react'

const emojiList = ['😀', '😁', '😂', '🤣', '😊', '😍', '😭', '😡', '😎', '🤔', '❤️', '💙', '👍', '👎', '🎉', '🔥', '🎵', '🎤', '☕', '✨', '🌈', '🎧', '📀']

export function EmojiButton({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full bg-sky-50 px-3 py-2 text-sm font-black text-brand-700"
        aria-label="打开 Emoji 表情"
      >
        😊
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 grid w-64 grid-cols-6 gap-1 rounded-2xl border border-sky-100 bg-white/95 p-3 shadow-xl backdrop-blur">
          {emojiList.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onSelect(emoji)
                setOpen(false)
              }}
              className="grid h-9 w-9 place-items-center rounded-xl text-xl transition hover:bg-sky-50"
              aria-label={`插入 ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
