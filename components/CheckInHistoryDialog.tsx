'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { redirectToLoginAfterConfirmedSessionInvalid } from '@/lib/client-auth'
import { getMoodDisplay, NO_MOOD_LABEL } from '@/lib/checkin-mood'
import { formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { CheckInMakeupDialog } from '@/components/CheckInMakeupDialog'
import {
  compareCheckInMonths,
  getCheckInCalendarCells,
  getCheckInMonthKey,
  getCurrentCheckInMonth,
  parseCheckInDateKey,
  shiftCheckInMonth,
  type CheckInCalendarCell,
  type CheckInHistoryDetail,
  type CheckInHistoryMonthRecord,
} from '@/lib/checkin-history'

type MonthResponse = {
  year: number
  month: number
  monthKey: string
  todayKey: string
  currentYear: number
  currentMonth: number
  earliestYear: number
  records: CheckInHistoryMonthRecord[]
  isFutureMonth: boolean
  makeup: {
    eligibleDateKeys: string[]
    availableDates: Array<{ dateKey: string; cost: number; freeChallengeAvailable: boolean; canUseNow?: boolean; weeklyUsed?: boolean; blockedReason?: string }>
    weeklyRemaining?: number
    weeklyAvailable: boolean
    monthlyChallengeAvailable: boolean
    monthlyChallengePending: boolean
    monthlyChallengeTargetDate: string | null
    cost: number
    currentBalance: number
  }
}
type DetailResponse = { record: CheckInHistoryDetail }

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function parseInitialMonth(dateKey: string) {
  const parsed = parseCheckInDateKey(dateKey)
  return parsed ? { year: parsed.year, month: parsed.month } : getCurrentCheckInMonth()
}

function cellClassName(cell: CheckInCalendarCell, record: CheckInHistoryMonthRecord | undefined, todayKey: string) {
  const future = cell.key > todayKey
  return [
    'checkin-history-day-cell',
    cell.isCurrentMonth ? '' : 'is-outside-month',
    cell.key === todayKey ? 'is-today' : '',
    future ? 'is-future' : '',
    record ? 'has-record' : '',
  ].filter(Boolean).join(' ')
}

export function CheckInHistoryDialog({ initialDate }: Readonly<{ initialDate: string }>) {
  const initialMonth = useMemo(() => parseInitialMonth(initialDate), [initialDate])
  const currentMonthFallback = useMemo(() => getCurrentCheckInMonth(), [])
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState(initialMonth)
  const [monthData, setMonthData] = useState<MonthResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<CheckInHistoryMonthRecord | null>(null)
  const [detail, setDetail] = useState<CheckInHistoryDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [selectedMakeupDate, setSelectedMakeupDate] = useState<string | null>(null)
  const cacheRef = useRef(new Map<string, MonthResponse>())
  const detailCacheRef = useRef(new Map<string, CheckInHistoryDetail>())
  const requestIdRef = useRef(0)
  const detailRequestIdRef = useRef(0)

  const currentMonth = monthData
    ? { year: monthData.currentYear, month: monthData.currentMonth, dateKey: monthData.todayKey }
    : currentMonthFallback
  const monthKey = getCheckInMonthKey(view.year, view.month)
  const recordsByDate = useMemo(
    () => new Map((monthData?.monthKey === monthKey ? monthData.records : []).map((record) => [record.dateKey, record])),
    [monthData, monthKey],
  )
  const calendarCells = useMemo(() => getCheckInCalendarCells(view.year, view.month), [view.month, view.year])
  const earliestYear = monthData?.earliestYear || currentMonth.year
  const yearOptions = useMemo(() => {
    const start = Math.min(earliestYear, currentMonth.year)
    return Array.from({ length: Math.max(1, currentMonth.year - start + 1) }, (_, index) => start + index)
  }, [currentMonth.year, earliestYear])
  const canGoPrevious = compareCheckInMonths(view, { year: earliestYear, month: 1 }) > 0
  const canGoNext = compareCheckInMonths(view, currentMonth) < 0

  const loadMonth = useCallback(async (year: number, month: number) => {
    const key = getCheckInMonthKey(year, month)
    const requestId = ++requestIdRef.current
    const cached = cacheRef.current.get(key)
    if (cached) {
      setMonthData(cached)
      setLoadError('')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setLoadError('')
    try {
      const response = await fetch(`/api/checkin/history?year=${year}&month=${month}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as MonthResponse | { message?: string } | null
      if (response.status === 401) {
        if (!(await redirectToLoginAfterConfirmedSessionInvalid(response, '/api/checkin/history'))) {
          if (requestId === requestIdRef.current) setLoadError('请求失败，请稍后重试。')
        }
        return
      }
      if (!response.ok || !data || !('records' in data)) throw new Error(data && 'message' in data ? data.message : '挂号记录暂时无法加载')
      cacheRef.current.set(key, data)
      if (requestId === requestIdRef.current) setMonthData(data)
    } catch (error) {
      if (requestId === requestIdRef.current) setLoadError(error instanceof Error ? error.message : '挂号记录暂时无法加载')
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) void loadMonth(view.year, view.month)
  }, [isOpen, loadMonth, view.month, view.year])

  useEffect(() => {
    const clearHistoryCache = () => {
      cacheRef.current.clear()
      detailCacheRef.current.clear()
      if (isOpen) setMonthData(null)
    }
    window.addEventListener('checkin:completed', clearHistoryCache)
    return () => window.removeEventListener('checkin:completed', clearHistoryCache)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selectedRecord) setSelectedRecord(null)
      else setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, selectedRecord])

  function changeMonth(year: number, month: number) {
    setView({ year, month })
    setSelectedRecord(null)
    setDetail(null)
    setPickerOpen(false)
  }

  function changeYear(year: number) {
    const month = year === currentMonth.year ? Math.min(view.month, currentMonth.month) : view.month
    changeMonth(year, month)
  }

  function goToToday() {
    changeMonth(currentMonth.year, currentMonth.month)
  }

  function goToPreviousMonth() {
    const previous = shiftCheckInMonth(view.year, view.month, -1)
    changeMonth(previous.year, previous.month)
  }

  function goToNextMonth() {
    const next = shiftCheckInMonth(view.year, view.month, 1)
    changeMonth(next.year, next.month)
  }

  async function openDetail(record: CheckInHistoryMonthRecord) {
    if (record.dateKey > currentMonth.dateKey) return
    const requestId = ++detailRequestIdRef.current
    setSelectedRecord(record)
    setDetailError('')
    const cached = detailCacheRef.current.get(record.dateKey)
    if (cached) {
      setDetail(cached)
      setDetailLoading(false)
      return
    }
    setDetail(null)
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/checkin/history/${record.dateKey}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as DetailResponse | { message?: string } | null
      if (response.status === 401) {
        if (!(await redirectToLoginAfterConfirmedSessionInvalid(response, `/api/checkin/history/${record.dateKey}`))) {
          if (requestId !== detailRequestIdRef.current) return
          setDetailError('请求失败，请稍后重试。')
        }
        return
      }
      if (!response.ok || !data || !('record' in data)) throw new Error(data && 'message' in data ? data.message : '当天记录暂时无法加载')
      if (requestId !== detailRequestIdRef.current) return
      detailCacheRef.current.set(record.dateKey, data.record)
      setDetail(data.record)
    } catch (error) {
      if (requestId !== detailRequestIdRef.current) return
      setDetailError(error instanceof Error ? error.message : '当天记录暂时无法加载')
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false)
    }
  }

  function closeDialog() {
    setIsOpen(false)
    setSelectedRecord(null)
    setDetail(null)
    setPickerOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className="checkin-history-trigger"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">▦</span>
        挂号记录
      </button>

      {isOpen ? (
        <div
          className="checkin-history-backdrop"
          data-checkin-history-dialog="true"
          onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
        >
          <section className="checkin-history-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-history-title">
            <header className="checkin-history-dialog-header">
              <div className="checkin-history-dialog-heading">
                <button
                  id="checkin-history-title"
                  type="button"
                  className="checkin-history-month-title"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((value) => !value)}
                >
                  {view.year}年 {view.month}月 <span aria-hidden="true">⌄</span>
                </button>
              </div>
              <button type="button" className="checkin-history-close" onClick={closeDialog} aria-label="关闭挂号记录">×</button>
            </header>

            <div className="checkin-history-toolbar">
              <button type="button" disabled={!canGoPrevious} onClick={goToPreviousMonth} aria-label="上一个月">←</button>
              <span>{view.year}年 {view.month}月</span>
              <button type="button" disabled={!canGoNext} onClick={goToNextMonth} aria-label="下一个月">→</button>
            </div>

            {pickerOpen ? (
              <div className="checkin-history-picker" aria-label="选择年月">
                <label>
                  <span>年份</span>
                  <select value={view.year} onChange={(event) => changeYear(Number(event.target.value))}>
                    {yearOptions.map((year) => <option key={year} value={year}>{year}年</option>)}
                  </select>
                </label>
                <label>
                  <span>月份</span>
                  <select value={view.month} onChange={(event) => changeMonth(view.year, Number(event.target.value))}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                      <option key={month} value={month} disabled={view.year === currentMonth.year && month > currentMonth.month}>{month}月</option>
                    ))}
                  </select>
                </label>
                {compareCheckInMonths(view, currentMonth) !== 0 ? <button type="button" className="checkin-history-today-link" onClick={goToToday}>回到本月</button> : null}
              </div>
            ) : null}

              <div className="checkin-history-dialog-body">
              {monthData ? <div className="mb-3 grid grid-cols-2 gap-2 text-sm font-black"><p className="border border-sky-100 bg-sky-50 p-2">本周补签：{monthData.makeup.weeklyAvailable ? '1次可用' : '已使用'}</p><p className="border border-sky-100 bg-sky-50 p-2">本月免费挑战：{monthData.makeup.monthlyChallengeAvailable || monthData.makeup.monthlyChallengePending ? '1次可用' : '已使用'}</p></div> : null}
              {loadError ? <p className="checkin-history-state is-error" role="alert">{loadError}</p> : null}
              {isLoading && !monthData ? <p className="checkin-history-state">正在加载本月记录…</p> : null}
              <div className="checkin-history-calendar" aria-label={`${view.year}年${view.month}月挂号记录`}>
                <div className="checkin-history-weekdays" aria-hidden="true">
                  {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
                </div>
                <div className="checkin-history-calendar-grid">
                  {calendarCells.map((cell) => {
                    const record = recordsByDate.get(cell.key)
                    const isFuture = cell.key > currentMonth.dateKey
                    const makeupDate = monthData?.makeup.availableDates.find((item) => item.dateKey === cell.key)
                    const canMakeUp = Boolean(makeupDate?.canUseNow !== false)
                    const hasMakeupDate = Boolean(makeupDate)
                    const visibleRecord = record && !isFuture ? record : undefined
                    const mood = visibleRecord ? getMoodDisplay(visibleRecord) : null
                    const madeUp = Boolean(visibleRecord?.type && visibleRecord.type !== 'NORMAL')
                    const moodLabel = madeUp ? '已补签' : mood?.label || (mood?.icon ? '' : '已挂号')
                    const content = (
                      <>
                        <span className="checkin-history-day-number">{cell.day}</span>
                        {visibleRecord ? <span className="checkin-history-mood" title={mood?.formatted || NO_MOOD_LABEL}>{mood?.icon ? <span aria-hidden="true">{mood.icon}</span> : null}<span className="checkin-history-mood-label">{moodLabel}</span></span> : null}
                      </>
                    )
                    return visibleRecord ? (
                      <button key={cell.key} type="button" className={cellClassName(cell, visibleRecord, currentMonth.dateKey)} onClick={() => void openDetail(visibleRecord)} aria-label={`${cell.key}，${madeUp ? '已补签' : mood?.label || '已挂号'}`}>
                        {content}
                      </button>
                    ) : hasMakeupDate ? (
                      <button key={cell.key} type="button" disabled={!canMakeUp} className={`${cellClassName(cell, undefined, currentMonth.dateKey)} is-makeup-available`} onClick={() => { if (canMakeUp) setSelectedMakeupDate(cell.key) }} aria-label={`${cell.key}，未挂号，${canMakeUp ? '可补签' : '本周补签次数已用完'}`}>
                        <span className="checkin-history-day-number">{cell.day}</span><span className="checkin-history-mood"><span className="checkin-history-mood-label">{canMakeUp ? '可补签' : '本周已用完'}</span></span>
                      </button>
                    ) : (
                      <div key={cell.key} className={cellClassName(cell, undefined, currentMonth.dateKey)} aria-hidden={isFuture ? 'true' : undefined}>
                        {content}
                      </div>
                    )
                  })}
                </div>
              </div>
              {!isLoading && monthData?.monthKey === monthKey && monthData.records.length === 0 ? <p className="checkin-history-empty">这个月还没有挂号记录</p> : null}
            </div>

            {selectedRecord ? (
              <div className="checkin-history-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelectedRecord(null) }}>
                <article className="checkin-history-detail" role="dialog" aria-modal="true" aria-labelledby="checkin-history-detail-title">
                  <header>
                    <div>
                      <h2 id="checkin-history-detail-title">{selectedRecord.dateKey.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日')}</h2>
                    </div>
                    <button type="button" className="checkin-history-close" onClick={() => setSelectedRecord(null)} aria-label="关闭当天详情">×</button>
                  </header>
                  <div className="checkin-history-detail-body">
                    {detailLoading ? <p className="checkin-history-state">正在加载当天详情…</p> : null}
                    {detailError ? <p className="checkin-history-state is-error" role="alert">{detailError}</p> : null}
                    {detail ? (
                      <>
                        <dl className="checkin-history-detail-facts">
                          <div><dt>今日心情</dt><dd>{getMoodDisplay(detail).formatted || NO_MOOD_LABEL}</dd></div>
                          <div><dt>挂号时间</dt><dd>{formatBeijingDateTimeMinute(detail.createdAt)}</dd></div>
                          <div><dt>挂号方式</dt><dd>{detail.type && detail.type !== 'NORMAL' ? '该日通过补签完成' : '正常挂号'}</dd></div>
                          {detail.streakDay > 0 ? <div><dt>连续挂号</dt><dd>{detail.streakDay} 天</dd></div> : null}
                        </dl>
                        <section className="checkin-history-message">
                          <h3>挂号留言</h3>
                          {detail.message ? <p>{detail.message}</p> : <p className="is-muted">当日没有留下挂号留言</p>}
                        </section>
                      </>
                    ) : null}
                  </div>
                </article>
              </div>
            ) : null}
            {selectedMakeupDate && monthData ? <CheckInMakeupDialog targetDate={selectedMakeupDate} monthlyChallengeAvailable={monthData.makeup.monthlyChallengeAvailable} monthlyChallengePending={monthData.makeup.monthlyChallengePending && monthData.makeup.monthlyChallengeTargetDate === selectedMakeupDate} currentBalance={monthData.makeup.currentBalance} cost={monthData.makeup.cost} onClose={() => setSelectedMakeupDate(null)} onCompleted={() => { cacheRef.current.clear(); detailCacheRef.current.clear(); setSelectedMakeupDate(null); void loadMonth(view.year, view.month) }} /> : null}
          </section>
        </div>
      ) : null}
    </>
  )
}
