'use client'

import { useEffect, useRef, useState } from 'react'
import { EmojiButton } from '@/components/EmojiPicker'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import { BEIJING_TIME_ZONE, formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { DAILY_MOODS, getMood } from '@/lib/daily'

export type TodayCheckIn = {
  checkDate: string | Date
  points: number
  exp: number
  mood: string | null
  message: string | null
  streakDay: number
  createdAt: string | Date
} | null

export type CheckInStats = {
  level: number
  points: number
  exp: number
  consecutiveDays: number
}

export type CheckInStateChange = {
  todayCheckIn: TodayCheckIn
  stats: CheckInStats
  created: boolean
  todayCount?: number
  totalCheckIns?: number
}

function formatBeijingTime(value?: string | Date | null) {
  if (!value) return '暂无'
  return formatBeijingDateTimeMinute(value)
}

function msUntilNextBeijingMidnight() {
  const now = new Date()
  const beijingNow = new Date(now.toLocaleString('en-US', { timeZone: BEIJING_TIME_ZONE }))
  const next = new Date(beijingNow)
  next.setDate(beijingNow.getDate() + 1)
  next.setHours(0, 0, 2, 0)
  return Math.max(next.getTime() - beijingNow.getTime(), 1000)
}

export function CheckInButton({
  initialCheckIn,
  initialStats,
  compact = false,
  density,
  previewMode = false,
  onStateChange,
}: Readonly<{
  initialCheckIn: TodayCheckIn
  initialStats: CheckInStats
  compact?: boolean
  density?: PageLayoutModuleDensity
  previewMode?: boolean
  onStateChange?: (state: CheckInStateChange) => void
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
  const displayDensity = density || (compact ? 'compact' : 'normal')
  const isCompact = displayDensity !== 'normal'
  const isMinimal = displayDensity === 'minimal'
  const isPreviewCompact = previewMode && displayDensity === 'compact'

  useEffect(() => {
    setTodayCheckIn(initialCheckIn)
    setStats(initialStats)
  }, [initialCheckIn, initialStats])

  useEffect(() => {
    if (previewMode) return
    let timer: number | undefined

    async function refreshTodayState() {
      try {
        const response = await fetch('/api/checkin', { cache: 'no-store' })
        const data = await response.json().catch(() => null)
        if (response.ok && data) {
          const nextCheckIn = data.todayCheckIn || null
          setTodayCheckIn(nextCheckIn)
          setStats((current) => {
            const refreshedStats = {
              ...current,
              level: data.level ?? current.level,
              points: data.points ?? current.points,
              exp: data.exp ?? current.exp,
              consecutiveDays: data.consecutiveDays ?? current.consecutiveDays,
            }
            onStateChange?.({
              todayCheckIn: nextCheckIn,
              stats: refreshedStats,
              created: false,
              todayCount: typeof data.todayCount === 'number' ? data.todayCount : undefined,
              totalCheckIns: typeof data.totalCheckIns === 'number' ? data.totalCheckIns : undefined,
            })
            return refreshedStats
          })
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
  }, [onStateChange, previewMode])

  useEffect(() => {
    if (previewMode) return
    const refresh = async () => {
      const response = await fetch('/api/checkin', { cache: 'no-store' }).catch(() => null)
      const data = await response?.json().catch(() => null)
      if (!response?.ok || !data) return
      const nextCheckIn = data.todayCheckIn || null
      const nextStats = {
        level: data.level ?? stats.level,
        points: data.points ?? stats.points,
        exp: data.exp ?? stats.exp,
        consecutiveDays: data.consecutiveDays ?? stats.consecutiveDays,
      }
      setTodayCheckIn(nextCheckIn)
      setStats(nextStats)
      onStateChange?.({ todayCheckIn: nextCheckIn, stats: nextStats, created: false, todayCount: data.todayCount, totalCheckIns: data.totalCheckIns })
    }
    const onStorage = (event: StorageEvent) => { if (event.key === 'checkin:last-updated') void refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', onStorage) }
  }, [onStateChange, previewMode, stats.exp, stats.level, stats.points, stats.consecutiveDays])

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
    if (previewMode || submittingRef.current || isSubmitting || todayCheckIn) return

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

      // POST成功后重新读取数据库真实状态
const verifyResponse = await fetch('/api/checkin', {
  cache: 'no-store',
})

const verifyData = await verifyResponse.json().catch(() => null)

if (!verifyResponse.ok || !verifyData) {
  setError('签到成功，但状态同步失败，请刷新页面')
  return
}

const nextCheckIn = verifyData.todayCheckIn || null

setTodayCheckIn(nextCheckIn)

const nextStats = {
  level: verifyData.level ?? stats.level,
  points: verifyData.points ?? stats.points,
  exp: verifyData.exp ?? stats.exp,
  consecutiveDays:
    verifyData.consecutiveDays ?? stats.consecutiveDays,
}

setStats(nextStats)

onStateChange?.({
  todayCheckIn: nextCheckIn,
  stats: nextStats,
  created: true,
  todayCount:
    typeof verifyData.todayCount === 'number'
      ? verifyData.todayCount
      : undefined,
  totalCheckIns:
    typeof verifyData.totalCheckIns === 'number'
      ? verifyData.totalCheckIns
      : undefined,
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
      window.localStorage.setItem('checkin:last-updated', `${data.checkDate}:${Date.now()}`)
    } catch {
      setError('挂号失败，请稍后重试')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  if (todayCheckIn) {
    const selectedMood = getMood(todayCheckIn.mood || '')
    if (isMinimal) {
      return (
        <div className={`flex flex-col justify-between gap-1 ${previewMode ? 'pointer-events-none select-none' : 'h-full min-h-0'}`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-2xl leading-none">{selectedMood?.icon || '♪'}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-brand-950">{selectedMood?.label || '已挂号'}</p>
              <p className="truncate text-[11px] font-bold text-slate-500">{formatBeijingTime(todayCheckIn.createdAt)}</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1">
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-brand-700">+{todayCheckIn.points} 积分</span>
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-brand-700">+{todayCheckIn.exp} 经验</span>
          </div>
        </div>
      )
    }
    return (
      <div className={`${isCompact ? 'space-y-2' : 'space-y-4'} ${previewMode ? 'pointer-events-none select-none' : ''}`}>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">Lv.{stats.level}</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">{stats.points} 积分</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">{stats.exp} 经验</span>
        </div>
        <div className={isCompact ? 'rounded-2xl border border-sky-100 bg-sky-50/70 p-3' : 'rounded-3xl border border-sky-100 bg-sky-50/70 p-5'}>
          <p className="text-xs font-black tracking-[0.14em] text-brand-700 sm:text-sm">今日心情</p>
          <h3 className={isCompact ? 'mt-1 text-xl font-black text-brand-950' : 'mt-2 text-3xl font-black text-brand-950'}>今日心情</h3>
          <div className={isCompact ? 'mt-2 flex items-center gap-2' : 'mt-4 flex items-center gap-3'}>
            <span className={isCompact ? 'text-3xl' : 'text-4xl'}>{selectedMood?.icon || '♪'}</span>
            <div>
              <p className="font-black text-brand-950">{selectedMood?.label || '已挂号'}</p>
              <p className="text-xs font-bold text-slate-500">挂号时间：{formatBeijingTime(todayCheckIn.createdAt)}</p>
            </div>
          </div>
          {todayCheckIn.message ? (
            <p className={isCompact ? 'mt-2 whitespace-pre-wrap rounded-2xl bg-white/80 px-3 py-2 text-xs font-bold leading-5 text-slate-700' : 'mt-4 whitespace-pre-wrap rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold leading-7 text-slate-700'}>{todayCheckIn.message}</p>
          ) : (
            <p className={isCompact ? 'mt-2 rounded-2xl bg-white/80 px-3 py-2 text-xs font-bold text-slate-500' : 'mt-4 rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold text-slate-500'}>今天没有填写留言。</p>
          )}
          <p className={isCompact ? 'mt-2 text-xs font-black text-emerald-700' : 'mt-4 text-sm font-black text-emerald-700'}>本次获得 +{todayCheckIn.points} 积分、+{todayCheckIn.exp} 经验</p>
        </div>
        {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      </div>
    )
  }

  return (
    <div className={`${isMinimal ? 'space-y-2' : isCompact ? 'space-y-3' : 'space-y-5'} ${previewMode ? 'pointer-events-none select-none' : ''}`}>
      <div>
        <p className="text-sm font-black text-slate-700">今日心情</p>
        <div data-checkin-mood-grid="true" className={isMinimal || isPreviewCompact ? 'mt-1 grid grid-cols-5 gap-1' : isCompact ? 'mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5' : 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'}>
          {DAILY_MOODS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={previewMode || isSubmitting}
              onClick={() => setMood(item.key)}
              className={`${isMinimal ? 'min-h-8 rounded-lg p-1 text-center' : isPreviewCompact ? 'min-h-10 rounded-lg p-1 text-center' : isCompact ? 'min-h-12 rounded-xl p-2' : 'min-h-20 rounded-2xl p-3'} border text-left transition ${
                mood === item.key
                  ? 'border-brand-500 bg-sky-100 shadow-lg shadow-sky-900/10'
                  : 'border-sky-100 bg-white/80 hover:border-brand-200 hover:bg-sky-50'
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              <span className={isMinimal ? 'text-lg leading-none' : isPreviewCompact ? 'text-xl leading-none' : isCompact ? 'text-xl' : 'text-3xl'}>{item.icon}</span>
              <span className={isMinimal || isPreviewCompact ? 'sr-only' : isCompact ? 'ml-1 inline text-xs font-black text-slate-800 sm:ml-0 sm:block' : 'mt-2 block text-sm font-black text-slate-800'}>{item.label}</span>
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
          disabled={previewMode || isSubmitting}
          rows={isMinimal || isPreviewCompact ? 1 : isCompact ? 2 : 4}
          placeholder="可以写一点今天的心情，也可以留空完成挂号。"
          className={isCompact ? 'mt-2 w-full resize-none rounded-2xl border border-sky-100 bg-white/85 px-3 py-2 text-sm font-bold leading-6 text-slate-700 outline-none transition focus:border-brand-300 disabled:opacity-70' : 'mt-3 w-full resize-none rounded-2xl border border-sky-100 bg-white/85 px-4 py-2 font-bold leading-7 text-slate-700 outline-none transition focus:border-brand-300 disabled:opacity-70'}
        />
        <div className={isCompact ? 'mt-1 flex items-center justify-between' : 'mt-2 flex items-center justify-between'}>
          <EmojiButton onSelect={insertEmoji} />
          <span className="text-xs font-bold text-slate-400">{note.length}/300</span>
        </div>
      </label>

      <button
        onClick={checkIn}
        disabled={previewMode || isSubmitting}
        className={isMinimal ? 'relative w-full overflow-hidden rounded-xl bg-brand-700 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60' : isCompact ? 'relative w-full overflow-hidden rounded-2xl bg-brand-700 px-4 py-2 text-sm font-black text-white shadow-lg shadow-sky-900/10 transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60' : 'relative w-full overflow-hidden rounded-2xl bg-brand-700 px-6 py-4 text-lg font-black text-white shadow-xl shadow-sky-900/10 transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60'}
      >
        {!isSubmitting ? <span className="absolute inset-0 animate-pulse bg-white/10" /> : null}
        <span className="relative">{isSubmitting ? '挂号中...' : '完成今日挂号'}</span>
      </button>

      {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
