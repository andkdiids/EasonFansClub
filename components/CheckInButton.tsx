'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckInGrowthGuideCard } from '@/components/CheckInGrowthGuideCard'
import { EmojiPicker } from '@/components/EmojiPicker'
import { BEIJING_TIME_ZONE, formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { CUSTOM_MOOD_INVALID_MESSAGE, CUSTOM_MOOD_MAX_GRAPHEMES, getMoodDisplay, NO_MOOD_LABEL, countGraphemes, truncateGraphemes, validateCustomMoodInput } from '@/lib/checkin-mood'
import { DAILY_MOODS } from '@/lib/daily'
import { CHECK_IN_MESSAGE_MAX_LENGTH } from '@/lib/checkin-message-constants'
import type { CheckInMessageItem } from '@/lib/checkin-messages'

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
  dailyMessageId?: string | null
  type?: 'NORMAL' | 'MAKEUP_FREE_QUIZ' | 'MAKEUP_PAID' | 'MAKEUP_ADMIN'
  isMakeUp?: boolean
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

function getCurrentBeijingDateKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function CheckInButton({
  initialCheckIn,
  initialStats,
  checkinMoodEnabled = true,
  todayValue,
  onStateChange,
}: Readonly<{
  initialCheckIn: TodayCheckIn
  initialStats: CheckInStats
  checkinMoodEnabled?: boolean
  todayValue?: string
  onStateChange?: (state: CheckInStateChange) => void
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const supplementTextareaRef = useRef<HTMLTextAreaElement>(null)
  const customMoodInputRef = useRef<HTMLInputElement>(null)
  const moodBeforeCustomRef = useRef('')
  const submittingRef = useRef(false)
  const supplementingRef = useRef(false)
  const knownDateRef = useRef(todayValue || getCurrentBeijingDateKey())
  const refreshPromiseRef = useRef<Promise<void> | null>(null)
  const [mood, setMood] = useState('')
  const [customMoodOpen, setCustomMoodOpen] = useState(false)
  const [customMoodEmoji, setCustomMoodEmoji] = useState('')
  const [customMoodText, setCustomMoodText] = useState('')
  const [customMoodError, setCustomMoodError] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [supplementDraft, setSupplementDraft] = useState('')
  const [supplementOpen, setSupplementOpen] = useState(false)
  const [supplementNotice, setSupplementNotice] = useState('')
  const [supplementError, setSupplementError] = useState('')
  const [isSupplementing, setIsSupplementing] = useState(false)
  const [todayCheckIn, setTodayCheckIn] = useState<TodayCheckIn>(initialCheckIn)
  const [stats, setStats] = useState(initialStats)
  const canSupplementToday = Boolean(
    todayCheckIn
      && todayCheckIn.type === 'NORMAL'
      && !todayCheckIn.isMakeUp
      && !todayCheckIn.dailyMessageId
      && !todayCheckIn.message?.trim(),
  )

  useEffect(() => {
    setTodayCheckIn(initialCheckIn)
    setStats(initialStats)
  }, [initialCheckIn, initialStats])

  useEffect(() => {
    setSupplementOpen(false)
    setSupplementDraft('')
    setSupplementError('')
    setSupplementNotice('')
  }, [todayCheckIn?.checkDate])

  useEffect(() => {
    if (supplementOpen) supplementTextareaRef.current?.focus()
  }, [supplementOpen])

  useEffect(() => {
    const refresh = async (force = false) => {
      const currentDateKey = getCurrentBeijingDateKey()
      if (!force && currentDateKey === knownDateRef.current) return
      if (refreshPromiseRef.current) return refreshPromiseRef.current

      const previousDateKey = knownDateRef.current
      const promise = (async () => {
        const response = await fetch('/api/checkin', { cache: 'no-store' }).catch(() => null)
        const data = await response?.json().catch(() => null)
        if (!response?.ok || !data) return

        const nextCheckIn = data.todayCheckIn || null
        const responseDateKey = typeof data.todayValue === 'string' ? data.todayValue : currentDateKey
        knownDateRef.current = responseDateKey
        setTodayCheckIn(nextCheckIn)
        setStats((current) => {
          const nextStats = {
            level: data.level ?? current.level,
            points: data.points ?? current.points,
            exp: data.exp ?? current.exp,
            consecutiveDays: data.consecutiveDays ?? current.consecutiveDays,
          }
          onStateChange?.({
            todayCheckIn: nextCheckIn,
            stats: nextStats,
            created: false,
            todayCount: typeof data.todayCount === 'number' ? data.todayCount : undefined,
            totalCheckIns: typeof data.totalCheckIns === 'number' ? data.totalCheckIns : undefined,
          })
          return nextStats
        })
        if (responseDateKey !== previousDateKey) {
          window.dispatchEvent(new CustomEvent('checkin:dayChanged', { detail: { date: responseDateKey } }))
        }
      })().finally(() => {
        refreshPromiseRef.current = null
      })
      refreshPromiseRef.current = promise
      return promise
    }

    const onFocus = () => void refresh()
    const onStorage = (event: StorageEvent) => { if (event.key === 'checkin:last-updated') void refresh(true) }
    window.addEventListener('focus', onFocus)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('storage', onStorage)
    }
  }, [onStateChange])

  useEffect(() => {
    if (todayValue) knownDateRef.current = todayValue
  }, [todayValue])
  
  function selectPresetMood(key: string) {
    setMood((current) => current === key ? '' : key)
    setCustomMoodOpen(false)
    setCustomMoodError('')
  }

  function openCustomMood() {
    if (mood === 'CUSTOM') {
      setMood('')
      setCustomMoodOpen(false)
      setCustomMoodError('')
      return
    }
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
    const currentDateKey = getCurrentBeijingDateKey()
    const dateChangedSinceRender = currentDateKey !== knownDateRef.current
    if (dateChangedSinceRender) {
      // 页面一直保持焦点时不会收到 focus 事件；用户主动点击时直接以服务端当前日期为准，
      // 避免旧日期的 todayCheckIn 状态阻塞新一天的首次挂号。
      knownDateRef.current = currentDateKey
      setTodayCheckIn(null)
    }
    if (submittingRef.current || isSubmitting || (!dateChangedSinceRender && todayCheckIn)) return

    setMessage('')
    setError('')

    if (checkinMoodEnabled && mood === 'CUSTOM' && !applyCustomMood()) return

    submittingRef.current = true
    setIsSubmitting(true)
    const submittingStartTime = Date.now()
    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood: checkinMoodEnabled && mood && mood !== 'CUSTOM' ? mood : null,
          moodType: checkinMoodEnabled && mood ? (mood === 'CUSTOM' ? 'CUSTOM' : 'PRESET') : null,
          moodKey: checkinMoodEnabled && mood && mood !== 'CUSTOM' ? mood : null,
          moodEmoji: checkinMoodEnabled && mood === 'CUSTOM' ? customMoodEmoji : null,
          moodText: checkinMoodEnabled && mood === 'CUSTOM' ? customMoodText : null,
          message: note,
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.message || '挂号失败')
        return
      }

      if (!data?.checkedToday || !data.todayCheckIn) {
        setError('签到状态异常，请刷新后重试')
        return
      }

      if (typeof data.checkDate === 'string') knownDateRef.current = data.checkDate

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

  async function supplementMessage() {
    if (supplementingRef.current || isSupplementing || !canSupplementToday) return

    if (!supplementDraft.trim()) {
      setSupplementError('请输入留言内容')
      return
    }

    supplementingRef.current = true
    setIsSupplementing(true)
    setSupplementError('')
    try {
      const response = await fetch('/api/checkin/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: supplementDraft }),
      })
      const data = await response.json().catch(() => null) as {
        message?: string
        checkDate?: string
        todayCheckIn?: TodayCheckIn
        dailyMessage?: CheckInMessageItem | null
      } | null

      if (!response.ok) {
        setSupplementError(data?.message || '留言补写失败，请稍后重试')
        return
      }

      const nextCheckIn = data?.todayCheckIn
      if (!nextCheckIn || !nextCheckIn.message) {
        setSupplementError('留言状态异常，请刷新后重试')
        return
      }

      setTodayCheckIn(nextCheckIn)
      setSupplementDraft('')
      setSupplementOpen(false)
      setSupplementNotice('留言已补写')
      setMessage('')
      onStateChange?.({ todayCheckIn: nextCheckIn, stats, created: false })
      window.dispatchEvent(new CustomEvent('checkin:completed', {
        detail: {
          date: data.checkDate || todayValue || getCurrentBeijingDateKey(),
          hasMessage: true,
          dailyMessage: data.dailyMessage || null,
        },
      }))
      if (data.checkDate) window.localStorage.setItem('checkin:last-updated', `${data.checkDate}:${Date.now()}`)
    } catch {
      setSupplementError('留言补写失败，请检查网络后重试')
    } finally {
      supplementingRef.current = false
      setIsSupplementing(false)
    }
  }

  function renderMessageSupplement() {
    if (!canSupplementToday) return null

    return (
      <div className="mt-3">
        {!supplementOpen ? (
          <button
            type="button"
            onClick={() => {
              setSupplementOpen(true)
              setSupplementError('')
              setSupplementNotice('')
            }}
            disabled={isSubmitting || isSupplementing}
            className="rounded-xl border border-brand-200 bg-white/85 px-3 py-2 text-xs font-black text-brand-700 transition hover:border-brand-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            补写留言
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void supplementMessage()
            }}
            className="space-y-2 rounded-2xl border border-sky-200 bg-white/85 p-3"
          >
            <label className="block">
              <span className="text-sm font-black text-brand-950">补写今日留言</span>
              <textarea
                ref={supplementTextareaRef}
                value={supplementDraft}
                onChange={(event) => {
                  setSupplementDraft(event.target.value.slice(0, CHECK_IN_MESSAGE_MAX_LENGTH))
                  setSupplementError('')
                }}
                disabled={isSupplementing}
                rows={3}
                maxLength={CHECK_IN_MESSAGE_MAX_LENGTH}
                placeholder="今天还想留下些什么吗？"
                className="mt-1 w-full resize-none rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold leading-6 text-slate-700 outline-none transition focus:border-brand-300 disabled:opacity-70"
              />
              <span className="mt-1 block text-right text-xs font-bold text-slate-400">{supplementDraft.length}/{CHECK_IN_MESSAGE_MAX_LENGTH}</span>
            </label>
            {supplementError ? <p role="alert" className="text-xs font-black text-red-600">{supplementError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSupplementOpen(false)
                  setSupplementError('')
                }}
                disabled={isSupplementing}
                className="rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSupplementing}
                className="rounded-xl bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSupplementing ? '保存中...' : '保存留言'}
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  if (todayCheckIn) {
    const selectedMood = getMoodDisplay(todayCheckIn)
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">Lv.{stats.level}</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">{stats.points} 挂号费</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 sm:text-xs">{stats.exp} 经验</span>
        </div>
        <CheckInGrowthGuideCard />
        <div className="rounded-3xl border border-sky-100 bg-sky-50/70 p-5">
          <p className="text-xs font-black tracking-[0.14em] text-brand-700 sm:text-sm">今日心情</p>
          <h3 className="mt-2 text-3xl font-black text-brand-950">今日心情</h3>
          <div className="mt-4 flex items-center gap-3">
            {selectedMood.icon ? <span className="text-4xl">{selectedMood.icon}</span> : null}
            <div>
              <p className="font-black text-brand-950">{selectedMood.label || NO_MOOD_LABEL}</p>
              <p className="text-xs font-bold text-slate-500">挂号时间：{formatBeijingTime(todayCheckIn.createdAt)}</p>
            </div>
          </div>
          {todayCheckIn.message ? (
            <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold leading-7 text-slate-700">{todayCheckIn.message}</p>
          ) : (
            <p className="mt-4 rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold text-slate-500">今天没有填写留言。</p>
          )}
          {renderMessageSupplement()}
          <p className="mt-4 text-sm font-black text-emerald-700">本次获得 +{todayCheckIn.points} 挂号费、+{todayCheckIn.exp} 经验</p>
          {todayCheckIn.streakDay >= 7 ? <p className="mt-1 text-xs font-black text-amber-700">长期患者奖励已生效：每日额外 +7 挂号费。</p> : null}
        </div>
        {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
        {supplementNotice ? <p className="text-sm font-black text-emerald-700">{supplementNotice}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {checkinMoodEnabled ? <div>
        <p className="text-sm font-black text-slate-700">今日心情（可选）</p>
        <div data-checkin-mood-grid="true" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {DAILY_MOODS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={isSubmitting}
              onClick={() => selectPresetMood(item.key)}
              className={`min-h-20 rounded-2xl p-3 border text-left transition ${
                mood === item.key
                  ? 'border-brand-500 bg-sky-100 shadow-lg shadow-sky-900/10'
                  : 'border-sky-100 bg-white/80 hover:border-brand-200 hover:bg-sky-50'
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              <span className="text-3xl">{item.icon}</span>
              <span className="mt-2 block text-sm font-black text-slate-800">{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={openCustomMood}
            className={`checkin-custom-mood-choice col-span-2 min-h-16 rounded-2xl p-3 border text-left transition sm:col-span-3 xl:col-span-5 ${mood === 'CUSTOM' ? 'border-brand-500 bg-sky-100 shadow-lg shadow-sky-900/10' : 'border-dashed border-sky-200 bg-white/70 hover:border-brand-200 hover:bg-sky-50'} disabled:cursor-not-allowed disabled:opacity-70`}
            aria-pressed={mood === 'CUSTOM'}
          >
            <span className="text-2xl">{customMoodEmoji || '＋'}</span>
            <span className="mt-1 block text-sm font-black text-slate-800">{customMoodText || '自定义'}</span>
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
                  disabled={isSubmitting}
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
                disabled={isSubmitting}
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
          disabled={isSubmitting}
          rows={4}
          placeholder="可以写一点今天的心情，也可以留空完成挂号。"
          className="mt-3 w-full resize-none rounded-2xl border border-sky-100 bg-white/85 px-4 py-2 font-bold leading-7 text-slate-700 outline-none transition focus:border-brand-300 disabled:opacity-70"
        />
        <div className="mt-2 flex items-center justify-between">
          <EmojiPicker textareaRef={textareaRef} value={note} onChange={setNote} maxLength={300} disabled={isSubmitting} />
          <span className="text-xs font-bold text-slate-400">{note.length}/300</span>
        </div>
      </label>

      <button
        onClick={checkIn}
        disabled={isSubmitting}
        className="relative w-full overflow-hidden rounded-2xl bg-brand-700 px-6 py-4 text-lg font-black text-white shadow-xl shadow-sky-900/10 transition hover:bg-brand-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        
        <span className="relative">{isSubmitting ? '挂号中...' : '完成今日挂号'}</span>
      </button>

      {message ? <p className="text-sm font-bold text-brand-700">{message}</p> : null}
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
