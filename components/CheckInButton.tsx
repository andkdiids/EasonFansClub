'use client'

import { useEffect, useRef, useState } from 'react'
import { EmojiButton } from '@/components/EmojiPicker'
import { DAILY_MOODS, getMood } from '@/lib/daily'

type TodayCheckIn = {
  checkDate: string | Date
  points: number
  exp: number
  mood: string | null
  message: string | null
  streakDay: number
  createdAt: string | Date
} | null

type CheckInStats = {
  level: number
  points: number
  exp: number
  consecutiveDays: number
}

function formatBeijingTime(value?: string | Date | null) {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function msUntilNextBeijingMidnight() {
  const now = new Date()
  const beijingNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const next = new Date(beijingNow)
  next.setDate(beijingNow.getDate() + 1)
  next.setHours(0, 0, 2, 0)
  return Math.max(next.getTime() - beijingNow.getTime(), 1000)
}

export function CheckInButton({
  initialCheckIn,
  initialStats,
}: Readonly<{
  initialCheckIn: TodayCheckIn
  initialStats: CheckInStats
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)
  const [mood, setMood] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [todayCheckIn, setTodayCheckIn] = useState<TodayCheckIn>(initialCheckIn)
  const [stats, setStats] = useState(initialStats)

  useEffect(() => {
    setTodayCheckIn(initialCheckIn)
    setStats(initialStats)
  }, [initialCheckIn, initialStats])

  useEffect(() => {
    let timer: number | undefined

    async function refreshTodayState() {
      try {
        const response = await fetch('/api/checkin', { cache: 'no-store' })
        const data = await response.json().catch(() => null)
        if (response.ok && data) {
          setTodayCheckIn(data.todayCheckIn || null)
          setStats((current) => ({
            ...current,
            level: data.level ?? current.level,
            points: data.points ?? current.points,
            exp: data.exp ?? current.exp,
            consecutiveDays: data.consecutiveDays ?? current.consecutiveDays,
          }))
          window.dispatchEvent(new CustomEvent('checkin:dayChanged', { detail: { date: data.todayValue } }))
        }
      } finally {
        timer = window.setTimeout(refreshTodayState, msUntilNextBeijingMidnight())
      }
    }

    timer = window.setTimeout(refreshTodayState, msUntilNextBeijingMidnight())
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [])

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
    if (submittingRef.current || isSubmitting || todayCheckIn) return

    setMessage('')
    setError('')

    if (!mood) {
      setError('请选择今日心情')
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood, message: note }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.message || '挂号失败')
        return
      }

      const nextCheckIn = data.todayCheckIn || {
        checkDate: data.checkDate,
        points: data.gainedPoints || 0,
        exp: data.gainedExp || 0,
        mood: data.mood?.key || mood,
        message: note || null,
        streakDay: data.consecutiveDays || 1,
        createdAt: new Date().toISOString(),
      }
      setTodayCheckIn(nextCheckIn)
      setStats({
        level: data.level ?? stats.level,
        points: data.points ?? stats.points,
        exp: data.exp ?? stats.exp,
        consecutiveDays: data.consecutiveDays ?? stats.consecutiveDays,
      })
      setMessage(`今日挂号成功，获得 +${data.gainedPoints || 0} 积分、+${data.gainedExp || 0} 经验`)
      window.dispatchEvent(
        new CustomEvent('checkin:completed', {
          detail: {
            date: data.checkDate,
            hasMessage: Boolean(data.dailyMessageId),
          },
        }),
      )
    } catch {
      setError('挂号失败，请稍后重试')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  if (todayCheckIn) {
    const selectedMood = getMood(todayCheckIn.mood || '')
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">Lv.{stats.level}</span>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{stats.points} 积分</span>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{stats.exp} 经验</span>
        </div>
        <div className="rounded-3xl border border-sky-100 bg-sky-50/70 p-5">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Today Mood</p>
          <h3 className="mt-2 text-3xl font-black text-brand-950">今日心情</h3>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-4xl">{selectedMood?.icon || '♪'}</span>
            <div>
              <p className="font-black text-brand-950">{selectedMood?.label || '已挂号'}</p>
              <p className="text-xs font-bold text-slate-500">挂号时间：{formatBeijingTime(todayCheckIn.createdAt)}</p>
            </div>
          </div>
          {todayCheckIn.message ? (
            <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-white/80 px-4 py-3 text-sm font-bold leading-7 text-slate-700">{todayCheckIn.message}</p>
          ) : (
            <p className="mt-4 rounded-2xl bg-white/80 px-4 py-3 text-sm font-bold text-slate-500">今天没有填写留言。</p>
          )}
          <p className="mt-4 text-sm font-black text-emerald-700">本次获得 +{todayCheckIn.points} 积分、+{todayCheckIn.exp} 经验</p>
        </div>
        {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">Lv.{stats.level}</span>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{stats.points} 积分</span>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{stats.exp} 经验</span>
      </div>

      <div>
        <p className="text-sm font-black text-slate-700">今日心情</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {DAILY_MOODS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={isSubmitting}
              onClick={() => setMood(item.key)}
              className={`min-h-20 rounded-2xl border p-3 text-left transition ${
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
          disabled={isSubmitting}
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
        disabled={isSubmitting}
        className="relative w-full overflow-hidden rounded-2xl bg-brand-700 px-6 py-4 text-lg font-black text-white shadow-xl shadow-sky-900/10 transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!isSubmitting ? <span className="absolute inset-0 animate-pulse bg-white/10" /> : null}
        <span className="relative">{isSubmitting ? '挂号中...' : '完成今日挂号'}</span>
      </button>

      {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
