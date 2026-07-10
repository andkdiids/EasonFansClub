'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { EmojiButton } from '@/components/EmojiPicker'
import { DAILY_MOODS } from '@/lib/daily'

export function CheckInButton({ checkedToday }: Readonly<{ checkedToday: boolean }>) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mood, setMood] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  function insertEmoji(emoji: string) {
    const input = textareaRef.current
    const start = input?.selectionStart ?? note.length
    const end = input?.selectionEnd ?? note.length
    const next = `${note.slice(0, start)}${emoji}${note.slice(end)}`.slice(0, 300)
    setNote(next)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  async function checkIn() {
    setMessage('')
    setError('')
    setSuccess(false)

    if (!mood) {
      setError('请选择今日心情')
      return
    }

    setIsSubmitting(true)
    const response = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood, message: note }),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setError(data.message || '挂号失败')
      return
    }

    setSuccess(true)
    setMessage(
      `今日挂号成功！获得 +${data.gainedPoints || 0} 积分、+${data.gainedExp || 0} 经验${
        data.bonus ? `，${data.bonus.label}` : ''
      }`,
    )
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-black text-slate-700">今日心情</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {DAILY_MOODS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={checkedToday}
              onClick={() => setMood(item.key)}
              className={`min-h-24 rounded-2xl border p-3 text-left transition ${
                mood === item.key
                  ? 'border-brand-500 bg-sky-100 shadow-lg shadow-sky-900/10'
                  : 'border-sky-100 bg-white/80 hover:border-brand-200 hover:bg-sky-50'
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              <span className="text-3xl">{item.icon}</span>
              <span className="mt-2 block text-sm font-black text-slate-800">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-black text-slate-700">今日留言</span>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 300))}
          disabled={checkedToday}
          rows={4}
          placeholder="可以写一点今天的心情，也可以留空完成挂号。"
          className="mt-3 w-full resize-none rounded-2xl border border-sky-100 bg-white/85 px-4 py-3 font-bold leading-7 text-slate-700 outline-none transition focus:border-brand-300 disabled:opacity-70"
        />
        <div className="mt-2 flex items-center justify-between">
          <EmojiButton onSelect={insertEmoji} />
          <span className="text-xs font-bold text-slate-400">{note.length}/300</span>
        </div>
      </label>

      <button
        onClick={checkIn}
        disabled={checkedToday || isSubmitting}
        className={`relative w-full overflow-hidden rounded-2xl px-6 py-4 text-lg font-black text-white shadow-xl shadow-sky-900/10 transition active:scale-[0.99] sm:w-auto ${
          checkedToday ? 'bg-slate-300' : 'bg-brand-700 hover:bg-brand-800'
        } disabled:cursor-not-allowed`}
      >
        {!checkedToday && !isSubmitting ? (
          <span className="absolute inset-0 animate-pulse bg-white/10" />
        ) : null}
        <span className="relative">{checkedToday ? '今日已挂号' : isSubmitting ? '挂号中...' : '完成今日挂号'}</span>
      </button>

      {success ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 font-black text-emerald-700">
          {message}
        </div>
      ) : message ? (
        <p className="text-sm font-bold text-brand-700">{message}</p>
      ) : null}
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
