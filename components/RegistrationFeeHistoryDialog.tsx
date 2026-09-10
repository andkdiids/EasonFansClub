'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { formatBeijingDateTimeMinute, getBeijingDateKey } from '@/lib/beijing-time'
import { REGISTRATION_FEE_HISTORY_PAGE_SIZE } from '@/lib/registration-fee-constants'

type HistoryRange = 'today' | 'yesterday' | 'week' | 'date'

type RegistrationFeeRecord = {
  id: string
  amount: number
  sourceLabel: string
  description: string | null
  createdAt: string
  displayDateTime?: string
}

type HistoryData = {
  currentBalance: number
  records: RegistrationFeeRecord[]
  page: number
  totalPages: number
}

const filters: Array<{ value: Exclude<HistoryRange, 'date'>; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'yesterday', label: '昨日' },
  { value: 'week', label: '本周' },
]

function getMonthKey(dateKey: string) {
  return dateKey.slice(0, 7)
}

function shiftMonth(monthKey: string, amount: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1 + amount, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

function getCalendarCells(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
    if (index < firstWeekday) return null
    return `${monthKey}-${String(index - firstWeekday + 1).padStart(2, '0')}`
  })
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-')
  return `${year}年${Number(month)}月`
}

function formatRecordDateTime(record: RegistrationFeeRecord) {
  return record.displayDateTime || formatBeijingDateTimeMinute(record.createdAt).slice(5)
}

export function RegistrationFeeHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const todayKey = useMemo(() => getBeijingDateKey(), [])
  const [range, setRange] = useState<HistoryRange>('today')
  const [customDate, setCustomDate] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey(todayKey))
  const [balance, setBalance] = useState<number | null>(null)
  const [records, setRecords] = useState<RegistrationFeeRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const rangeRef = useRef<HistoryRange>('today')
  const customDateRef = useRef('')

  const loadPage = useCallback(async (
    nextPage: number,
    replace: boolean,
    nextRange: HistoryRange = rangeRef.current,
    nextDate = customDateRef.current,
  ) => {
    const requestId = ++requestIdRef.current
    if (replace) {
      setLoading(true)
      setLoadingMore(false)
      setRecords([])
      setPage(1)
      setTotalPages(1)
    } else {
      setLoadingMore(true)
    }
    setError('')

    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(REGISTRATION_FEE_HISTORY_PAGE_SIZE),
      range: nextRange,
    })
    if (nextRange === 'date' && nextDate) params.set('date', nextDate)

    try {
      const response = await fetch(`/api/points/history?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: HistoryData; message?: string } | null
      if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.message || '挂号费记录加载失败')
      if (requestId !== requestIdRef.current) return

      setBalance(payload.data.currentBalance)
      setPage(payload.data.page)
      setTotalPages(payload.data.totalPages)
      setRecords((previous) => {
        if (replace) return payload.data?.records || []
        const existingIds = new Set(previous.map((record) => record.id))
        return [...previous, ...(payload.data?.records || []).filter((record) => !existingIds.has(record.id))]
      })
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      setError(loadError instanceof Error ? loadError.message : '挂号费记录加载失败')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1
      return
    }
    rangeRef.current = 'today'
    customDateRef.current = ''
    setRange('today')
    setCustomDate('')
    setCalendarOpen(false)
    setCalendarMonth(getMonthKey(todayKey))
    setBalance(null)
    void loadPage(1, true, 'today', '')
  }, [loadPage, open, todayKey])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  function selectRange(nextRange: Exclude<HistoryRange, 'date'>) {
    rangeRef.current = nextRange
    customDateRef.current = ''
    setRange(nextRange)
    setCustomDate('')
    setCalendarOpen(false)
    void loadPage(1, true, nextRange, '')
  }

  function chooseDate(dateKey: string) {
    rangeRef.current = 'date'
    customDateRef.current = dateKey
    setRange('date')
    setCustomDate(dateKey)
    setCalendarMonth(getMonthKey(dateKey))
    setCalendarOpen(false)
    void loadPage(1, true, 'date', dateKey)
  }

  function openCalendar() {
    setCalendarMonth(getMonthKey(customDate || todayKey))
    setCalendarOpen((value) => !value)
  }

  function handleListScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    const closeToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    if (closeToBottom && !loading && !loadingMore && page < totalPages) {
      void loadPage(page + 1, false)
    }
  }

  const calendarCells = useMemo(() => getCalendarCells(calendarMonth), [calendarMonth])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="growth-fee-history-backdrop" role="presentation" onClick={onClose}>
      <section
        className="growth-fee-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="growth-fee-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="growth-fee-history-header">
          <div>
            <h2 id="growth-fee-history-title">挂号费记录</h2>
            <p>{balance === null ? '加载中…' : `当前余额 ${balance}`}</p>
          </div>
          <button type="button" className="growth-fee-history-close" onClick={onClose} aria-label="关闭挂号费记录">×</button>
        </header>

        <div className="growth-fee-history-filters" aria-label="记录日期筛选">
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className="growth-fee-history-filter"
              data-active={range === filter.value}
              aria-pressed={range === filter.value}
              onClick={() => selectRange(filter.value)}
            >
              {filter.label}
            </button>
          ))}
          <button
            type="button"
            className="growth-fee-history-filter growth-fee-history-date-trigger"
            data-active={range === 'date'}
            aria-pressed={range === 'date'}
            aria-expanded={calendarOpen}
            onClick={openCalendar}
          >
            {customDate || '选择日期'}
          </button>
        </div>

        {calendarOpen ? (
          <div className="growth-fee-history-calendar" aria-label="选择记录日期">
            <div className="growth-fee-history-calendar-header">
              <button type="button" onClick={() => setCalendarMonth((value) => shiftMonth(value, -1))} aria-label="上个月">‹</button>
              <strong>{formatMonthLabel(calendarMonth)}</strong>
              <button type="button" onClick={() => setCalendarMonth((value) => shiftMonth(value, 1))} aria-label="下个月">›</button>
            </div>
            <div className="growth-fee-history-calendar-weekdays" aria-hidden="true">
              {['日', '一', '二', '三', '四', '五', '六'].map((weekday) => <span key={weekday}>{weekday}</span>)}
            </div>
            <div className="growth-fee-history-calendar-grid">
              {calendarCells.map((dateKey, index) => dateKey ? (
                <button
                  key={dateKey}
                  type="button"
                  data-today={dateKey === todayKey}
                  data-selected={dateKey === customDate}
                  aria-current={dateKey === todayKey ? 'date' : undefined}
                  aria-pressed={dateKey === customDate}
                  onClick={() => chooseDate(dateKey)}
                >
                  {Number(dateKey.slice(-2))}
                </button>
              ) : <span key={`empty-${index}`} aria-hidden="true" />)}
            </div>
          </div>
        ) : null}

        <div className="growth-fee-history-list" role="list" aria-busy={loading || loadingMore} onScroll={handleListScroll}>
          {loading ? <p className="growth-fee-history-status">加载中…</p> : null}
          {!loading && !records.length && !error ? <p className="growth-fee-history-status">暂无挂号费记录</p> : null}
          {records.map((record) => (
            <article className="growth-fee-history-record" role="listitem" key={record.id}>
              <div className="growth-fee-history-record-main">
                <time dateTime={record.createdAt}>{formatRecordDateTime(record)}</time>
                <strong>{record.sourceLabel}</strong>
                {record.description ? <p>{record.description}</p> : null}
              </div>
              <span className={record.amount >= 0 ? 'is-positive' : 'is-negative'}>{record.amount >= 0 ? '+' : ''}{record.amount}</span>
            </article>
          ))}
          {error ? <p className="growth-fee-history-error" role="alert">{error}</p> : null}
          {loadingMore ? <p className="growth-fee-history-status">加载更多…</p> : null}
          {!loading && !loadingMore && !error && records.length && page < totalPages ? <p className="growth-fee-history-status">上拉加载更多</p> : null}
        </div>
      </section>
    </div>,
    document.body,
  )
}
