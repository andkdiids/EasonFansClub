'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckInGrowthGuideCard } from '@/components/CheckInGrowthGuideCard'
import { EmojiPicker } from '@/components/EmojiPicker'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import { BEIJING_TIME_ZONE, formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { CUSTOM_MOOD_INVALID_MESSAGE, CUSTOM_MOOD_MAX_GRAPHEMES, getMoodDisplay, countGraphemes, truncateGraphemes, validateCustomMoodInput } from '@/lib/checkin-mood'
import { DAILY_MOODS } from '@/lib/daily'

export type TodayCheckIn = {
  checkDate: string | Date
  points: number
  exp: number
  mood: string | null
  moodType?: string | null
  moodEmoji?: string | null
  moodText?: string | null
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
  checkinMoodEnabled = true,
  onStateChange,
}: Readonly<{
  initialCheckIn: TodayCheckIn
  initialStats: CheckInStats
  compact?: boolean
  density?: PageLayoutModuleDensity
  previewMode?: boolean
  checkinMoodEnabled?: boolean
  onStateChange?: (state: CheckInStateChange) => void
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const customMoodInputRef = useRef<HTMLInputElement>(null)
  const moodBeforeCustomRef = useRef('')
  const submittingRef = useRef(false)
  const [mood, setMood] = useState('')
  const [customMoodOpen, setCustomMoodOpen] = useState(false)
  const [customMoodEmoji, setCustomMoodEmoji] = useState('')
  const [customMoodText, setCustomMoodText] = useState('')
  const [customMoodError, setCustomMoodError] = useState('')
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
      setTodayCheckIn(nextCheckIn)
      setStats((current) => {
        const nextStats = {
          level: data.level ?? current.level,
          points: data.points ?? current.points,
          exp: data.exp ?? current.exp,
          consecutiveDays: data.consecutiveDays ?? current.consecutiveDays,
        }
        onStateChange?.({ todayCheckIn: nextCheckIn, stats: nextStats, created: false, todayCount: data.todayCount, totalCheckIns: data.totalCheckIns })
        return nextStats
      })
    }
    const onStorage = (event: StorageEvent) => { if (event.key === 'checkin:last-updated') void refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', onStorage) }
  }, [onStateChange, previewMode])
  
  function selectPresetMood(key: string) {
    setMood(key)
    setCustomMoodOpen(false)
    setCustomMoodError('')
  }

  function openCustomMood() {
    moodBeforeCustomRef.current = mood
    setMood('CUSTOM')
    setCustomMoodOpen(true)
    setCustomMoodError('')
  }

  function cancelCustomMood() {
    setMood(moodBeforeCustomRef.current)
    setCustomMoodOpen(false)
    setCustomMoodError('')
  }

  function applyCustomMood() {
    const validation = validateCustomMoodInput({ emoji: customMoodEmoji, text: customMoodText })
    if (!validation.ok) {
      setCustomMoodError(validation.reason === 'emoji' ? '请选择一个 Emoji。' : validation.reason === 'too-long' ? CUSTOM_MOOD_INVALID_MESSAGE : '请填写心情文字。')
      return false
    }
    setCustomMoodEmoji(validation.emoji)
    setCustomMoodText(validation.text)
    setMood('CUSTOM')
    setCustomMoodOpen(false)
    setCustomMoodError('')
    return true
  }

  async function checkIn() {
    if (previewMode || submittingRef.current || isSubmitting || todayCheckIn) return

    setMessage('')
    setError('')

    if (checkinMoodEnabled && !mood) {
      setError('请选择今日心情')
      return
    }

    if (checkinMoodEnabled && mood === 'CUSTOM' && !applyCustomMood()) return

    submittingRef.current = true
    setIsSubmitting(true)
    const submittingStartTime = Date.now()
    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood: checkinMoodEnabled && mood !== 'CUSTOM' ? mood : null,
          moodType: checkinMoodEnabled && mood === 'CUSTOM' ? 'CUSTOM' : 'PRESET',
          moodKey: checkinMoodEnabled && mood !== 'CUSTOM' ? mood : null,
          moodEmoji: checkinMoodEnabled && mood === 'CUSTOM' ? customMoodEmoji : null,
          moodText: checkinMoodEnabled && mood === 'CUSTOM' ? customMoodText : null,
          message: note,
        }),
      })
      let data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.message || '挂号失败')
        return
      }

      const verifyResponse = await fetch('/api/checkin', { cache: 'no-store' }).catch(() => null)
      const verifyData = await verifyResponse?.json().catch(() => null)
      if (verifyResponse?.ok && verifyData?.checkedToday && verifyData.todayCheckIn) {
        data = { ...data, ...verifyData, created: data.created }
      }

      if (!data?.checkedToday || !data.todayCheckIn) {
        setError('签到状态异常，请刷新后重试')
        return
      }

const elapsed = Date.now() - submittingStartTime
const remaining = 1000 - elapsed

if (remaining > 0) {
  await new Promise((resolve) => setTimeout(resolve, remaining))
}
      const nextCheckIn = data.todayCheckIn || null

      setTodayCheckIn(nextCheckIn)

      const nextStats = {
        level: data.level ?? stats.level,
        points: data.points ?? stats.points,
        exp: data.exp ?? stats.exp,
        consecutiveDays: data.consecutiveDays ?? stats.consecutiveDays,
      }

      setStats(nextStats)

      onStateChange?.({
        todayCheckIn: nextCheckIn,
        stats: nextStats,
        created: true,
        todayCount: typeof data.todayCount === 'number' ? data.todayCount : undefined,
        totalCheckIns: typeof data.totalCheckIns === 'number' ? data.totalCheckIns : undefined,
      })
      
      const streakBonus = Number(data.streakBonusRegistrationFee) || 0
      const feeMessage = `今日挂号成功，获得 +${nextCheckIn.points} 挂号费、+${nextCheckIn.exp} 经验`
      setMessage(streakBonus ? `${feeMessage}（含长期患者奖励 +${streakBonus} 挂号费）` : feeMessage)
      let createdMessage = data.dailyMessage || null
      if (!createdMessage && data.dailyMessageId) {
        const messagesResponse = await fetch(
          `/api/checkin/messages?date=${encodeURIComponent(data.checkDate)}&scope=public`,
          { cache: 'no-store' },
        )
        const messagesData = await messagesResponse.json().catch(() => null)
        createdMessage = Array.isArray(messagesData?.messages)
          ? messagesData.messages.find((item: { id?: unknown }) => item.id === data.dailyMessageId) || null
          : null
      }
      window.dispatchEvent(
        new CustomEvent('checkin:completed', {
          detail: {
            date: data.checkDate,
            hasMessage: Boolean(data.dailyMessageId),
            dailyMessage: createdMessage,
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
    const selectedMood = getMoodDisplay(todayCheckIn)
    if (isMinimal) {
      return (
        <div className={`flex flex-col justify-between gap-1 ${previewMode ? 'pointer-events-none select-none' : 'h-full min-h-0'}`}>
          <div className="flex min-w-0 items-center gap-2">
            {selectedMood.icon ? <span className="text-2xl leading-none">{selectedMood.icon}</span> : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-brand-950">{selectedMood.label || '未填写心情'}</p>
              <p className="truncate text-[11px] font-bold text-slate-500">{formatBeijingTime(todayCheckIn.createdAt)}</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1">
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-brand-700">+{todayCheckIn.points} 挂号费</span>
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-brand-700">+{todayCheckIn.exp} 经验</span>
          </div>
        </div>
      )
    }
    return (
      <div className={`${isCompact ? 'space-y-2' : 'space-y-4'} ${previewMode ? 'pointer-events-none select-none' : ''}`}>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">Lv.{stats.level}</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">{stats.points} 挂号费</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">{stats.exp} 经验</span>
        </div>
        <CheckInGrowthGuideCard compact={isCompact} />
        <div className={isCompact ? 'rounded-2xl border border-sky-100 bg-sky-50/70 p-3' : 'rounded-3xl border border-sky-100 bg-sky-50/70 p-5'}>
          <p className="text-xs font-black tracking-[0.14em] text-brand-700 sm:text-sm">今日心情</p>
          <h3 className={isCompact ? 'mt-1 text-xl font-black text-brand-950' : 'mt-2 text-3xl font-black text-brand-950'}>今日心情</h3>
          <div className={isCompact ? 'mt-2 flex items-center gap-2' : 'mt-4 flex items-center gap-3'}>
            {selectedMood.icon ? <span className={isCompact ? 'text-3xl' : 'text-4xl'}>{selectedMood.icon}</span> : null}
            <div>
              <p className="font-black text-brand-950">{selectedMood.label || '未填写心情'}</p>
              <p className="text-xs font-bold text-slate-500">挂号时间：{formatBeijingTime(todayCheckIn.createdAt)}</p>
            </div>
          </div>
          {todayCheckIn.message ? (
            <p className={isCompact ? 'mt-2 whitespace-pre-wrap rounded-2xl bg-white/80 px-3 py-2 text-xs font-bold leading-5 text-slate-700' : 'mt-4 whitespace-pre-wrap rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold leading-7 text-slate-700'}>{todayCheckIn.message}</p>
          ) : (
            <p className={isCompact ? 'mt-2 rounded-2xl bg-white/80 px-3 py-2 text-xs font-bold text-slate-500' : 'mt-4 rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold text-slate-500'}>今天没有填写留言。</p>
          )}
          <p className={isCompact ? 'mt-2 text-xs font-black text-emerald-700' : 'mt-4 text-sm font-black text-emerald-700'}>本次获得 +{todayCheckIn.points} 挂号费、+{todayCheckIn.exp} 经验</p>
          {todayCheckIn.streakDay >= 7 ? <p className="mt-1 text-xs font-black text-amber-700">长期患者奖励已生效：每日额外 +7 挂号费。</p> : null}
        </div>
        {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      </div>
    )
  }

  return (
    <div className={`${isMinimal ? 'space-y-2' : isCompact ? 'space-y-3' : 'space-y-5'} ${previewMode ? 'pointer-events-none select-none' : ''}`}>
      {checkinMoodEnabled ? <div>
        <p className="text-sm font-black text-slate-700">今日心情</p>
        <div data-checkin-mood-grid="true" className={isMinimal || isPreviewCompact ? 'mt-1 grid grid-cols-5 gap-1' : isCompact ? 'mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5' : 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'}>
          {DAILY_MOODS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={previewMode || isSubmitting}
              onClick={() => selectPresetMood(item.key)}
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
          <button
            type="button"
            disabled={previewMode || isSubmitting}
            onClick={openCustomMood}
            className={`checkin-custom-mood-choice ${isMinimal ? 'col-span-5 min-h-8 rounded-lg p-1 text-center' : isPreviewCompact ? 'col-span-5 min-h-10 rounded-lg p-1 text-center' : isCompact ? 'col-span-2 min-h-12 rounded-xl p-2 sm:col-span-3 xl:col-span-5' : 'col-span-2 min-h-16 rounded-2xl p-3 sm:col-span-3 xl:col-span-5'} border text-left transition ${mood === 'CUSTOM' ? 'border-brand-500 bg-sky-100 shadow-lg shadow-sky-900/10' : 'border-dashed border-sky-200 bg-white/70 hover:border-brand-200 hover:bg-sky-50'} disabled:cursor-not-allowed disabled:opacity-70`}
            aria-pressed={mood === 'CUSTOM'}
          >
            <span className={isMinimal ? 'text-lg leading-none' : isPreviewCompact ? 'text-xl leading-none' : isCompact ? 'text-xl' : 'text-2xl'}>{customMoodEmoji || '＋'}</span>
            <span className={isMinimal || isPreviewCompact ? 'sr-only' : isCompact ? 'ml-1 inline text-xs font-black text-slate-800 sm:ml-0 sm:block' : 'mt-1 block text-sm font-black text-slate-800'}>{customMoodText || '自定义'}</span>
          </button>
        </div>
        {customMoodOpen ? (
          <div data-checkin-custom-mood="true" className="checkin-custom-mood-panel relative z-10 mt-3 space-y-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-brand-950">自定义心情</p>
                <p className="mt-1 text-xs font-bold text-slate-500">Emoji 和心情文字都要填写</p>
              </div>
              <div className="relative flex items-center gap-2">
                <span className="grid h-10 min-w-10 place-items-center rounded-xl border border-sky-200 bg-white/80 px-2 text-2xl" aria-label={customMoodEmoji ? `已选择 ${customMoodEmoji}` : '尚未选择 Emoji'}>{customMoodEmoji || '？'}</span>
                <EmojiPicker
                  textareaRef={customMoodInputRef}
                  value={customMoodText}
                  onChange={setCustomMoodText}
                  onSelectEmoji={(emoji) => {
                    setCustomMoodEmoji(emoji)
                    setCustomMoodError('')
                  }}
                  triggerEmoji="😀"
                  triggerLabel="选择 Emoji"
                  disabled={previewMode || isSubmitting}
                />
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-black text-slate-700">心情文字</span>
              <input
                ref={customMoodInputRef}
                value={customMoodText}
                onChange={(event) => {
                  setCustomMoodText(truncateGraphemes(event.target.value, CUSTOM_MOOD_MAX_GRAPHEMES))
                  setCustomMoodError('')
                }}
                disabled={previewMode || isSubmitting}
                inputMode="text"
                placeholder="今天很开心"
                className="mt-1 w-full min-w-0 rounded-xl border border-sky-200 bg-white/85 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-brand-300"
              />
              <span className="mt-1 block text-right text-xs font-bold text-slate-400">{countGraphemes(customMoodText)} / {CUSTOM_MOOD_MAX_GRAPHEMES}</span>
            </label>
            {customMoodError ? <p role="alert" className="text-xs font-black text-red-600">{customMoodError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelCustomMood} disabled={isSubmitting} className="rounded-xl border border-sky-200 bg-white/80 px-4 py-2 text-sm font-black text-slate-600 disabled:opacity-60">取消</button>
              <button type="button" onClick={applyCustomMood} disabled={isSubmitting} className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60">使用</button>
            </div>
          </div>
        ) : null}
      </div> : null}

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
          <EmojiPicker textareaRef={textareaRef} value={note} onChange={setNote} maxLength={300} disabled={previewMode || isSubmitting} />
          <span className="text-xs font-bold text-slate-400">{note.length}/300</span>
        </div>
      </label>

      <button
        onClick={checkIn}
        disabled={previewMode || isSubmitting}
        className={isMinimal ? 'relative w-full overflow-hidden rounded-xl bg-brand-700 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60' : isCompact ? 'relative w-full overflow-hidden rounded-2xl bg-brand-700 px-4 py-2 text-sm font-black text-white shadow-lg shadow-sky-900/10 transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60' : 'relative w-full overflow-hidden rounded-2xl bg-brand-700 px-6 py-4 text-lg font-black text-white shadow-xl shadow-sky-900/10 transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60'}
      >
        
        <span className="relative">{isSubmitting ? '挂号中...' : '完成今日挂号'}</span>
      </button>

      {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
