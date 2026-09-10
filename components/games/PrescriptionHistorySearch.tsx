'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { PrescriptionUserBadge } from '@/components/games/PrescriptionUserBadge'
import { SavePrescriptionButton } from '@/components/games/SavePrescriptionButton'
import type { DailyPrescriptionHistoryRecord } from '@/lib/entertainment'

type HistoryData = Readonly<{
  records: DailyPrescriptionHistoryRecord[]
  query: string
  dateKey: string | null
  pagination: Readonly<{
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasPrevious: boolean
    hasNext: boolean
  }>
}>

type SearchStatus = 'idle' | 'loading' | 'empty' | 'success' | 'error'

type SearchResponse = Readonly<{
  ok?: boolean
  data?: HistoryData
  error?: string
}>

function formatDate(dateKey: string) {
  return dateKey.replace(/^(\d{4})-(\d{2})-(\d{2})$/u, '$1.$2.$3')
}

function buildHistoryUrl(query: string, page = 1) {
  const params = new URLSearchParams(window.location.search)
  params.delete('date')
  const normalized = query.trim()
  if (normalized) params.set('q', normalized)
  else params.delete('q')
  if (page > 1) params.set('page', String(page))
  else params.delete('page')
  const search = params.toString()
  return `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
}

function getSearchResultHref(dateKey: string) {
  return `/prescription/history?date=${encodeURIComponent(dateKey)}`
}

function FocusedHistoryRecord({ record }: Readonly<{ record: DailyPrescriptionHistoryRecord }>) {
  return (
    <article id={`prescription-${record.id}`} className="prescription-card prescription-history-focused-record">
      <header>
        <p>私家E院 · 历史处方 · {formatDate(record.dateKey)}</p>
        <PrescriptionUserBadge user={record.user} />
      </header>
      <div className="prescription-points">
        <span>获得奖励</span>
        <strong>{record.rewarded ? `+${record.points} 挂号费` : '未获得奖励'}</strong>
        <small>{record.rewardFromLedger ? '奖励来自当日挂号费流水' : '奖励来自处方记录快照'}</small>
      </div>
      <div className="prescription-lyric">
        <span>当日歌词处方</span>
        {record.lyric ? (
          <>
            <blockquote>「{record.lyric.text}」</blockquote>
            <cite>——《{record.lyric.songTitle}》</cite>
          </>
        ) : (
          <p>当天没有歌词处方内容。</p>
        )}
      </div>
      <footer>
        <span>处方编号：{record.prescriptionCode} · 开具时间：{record.issuedAtBeijing}</span>
        <SavePrescriptionButton data={record} />
      </footer>
    </article>
  )
}

export function PrescriptionHistorySearch({
  initialData,
  initialQuery = '',
  initialDateKey = null,
  children,
}: Readonly<{
  initialData: HistoryData
  initialQuery?: string
  initialDateKey?: string | null
  children: ReactNode
}>) {
  const router = useRouter()
  const normalizedInitialQuery = initialQuery.trim()
  const [query, setQuery] = useState(normalizedInitialQuery)
  const [searchData, setSearchData] = useState<HistoryData | null>(normalizedInitialQuery ? initialData : null)
  const [focusedDateKey, setFocusedDateKey] = useState<string | null>(initialDateKey)
  const [searchStatus, setSearchStatus] = useState<SearchStatus>(
    normalizedInitialQuery ? (initialData.records.length ? 'success' : 'empty') : 'idle',
  )
  const [searchPage, setSearchPage] = useState(initialData.pagination.page)
  const requestIdRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const skipInitialRequestRef = useRef(Boolean(normalizedInitialQuery))

  const loadSearch = useCallback(async (value: string, page: number) => {
    const normalized = value.trim()
    if (!normalized) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    setSearchStatus('loading')

    try {
      const params = new URLSearchParams({ q: normalized, page: String(page) })
      const response = await fetch(`/api/entertainment/daily-draw/history?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const payload = await response.json() as SearchResponse
      if (requestId !== requestIdRef.current) return
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '搜索失败')
      setSearchData(payload.data)
      setSearchPage(payload.data.pagination.page)
      setSearchStatus(payload.data.records.length ? 'success' : 'empty')
    } catch (reason: unknown) {
      if (requestId !== requestIdRef.current) return
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setSearchStatus('error')
    }
  }, [])

  useEffect(() => {
    const nextQuery = initialQuery.trim()
    skipInitialRequestRef.current = Boolean(nextQuery)
    setQuery(nextQuery)
    setSearchData(nextQuery ? initialData : null)
    setFocusedDateKey(initialDateKey)
    setSearchPage(initialData.pagination.page)
    setSearchStatus(nextQuery ? (initialData.records.length ? 'success' : 'empty') : 'idle')
  }, [initialData, initialDateKey, initialQuery])

  useEffect(() => {
    const normalized = query.trim()
    if (!normalized) {
      controllerRef.current?.abort()
      setSearchData(null)
      setSearchStatus('idle')
      setSearchPage(1)
      return
    }

    if (skipInitialRequestRef.current && normalized === normalizedInitialQuery) {
      skipInitialRequestRef.current = false
      return
    }

    const timer = window.setTimeout(() => {
      setSearchPage(1)
      void loadSearch(normalized, 1)
    }, 320)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [loadSearch, normalizedInitialQuery, query])

  function updateUrl(nextQuery: string, page = 1) {
    window.history.replaceState(window.history.state, '', buildHistoryUrl(nextQuery, page))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = query.trim()
    requestIdRef.current += 1
    controllerRef.current?.abort()
    setFocusedDateKey(null)
    updateUrl(normalized)
    if (normalized) void loadSearch(normalized, 1)
  }

  function handleQueryChange(value: string) {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    skipInitialRequestRef.current = false
    setFocusedDateKey(null)
    setQuery(value)
    setSearchPage(1)
    updateUrl(value)
    if (value.trim()) setSearchStatus('loading')
  }

  function handleDateChange(value: string) {
    if (!value) return
    requestIdRef.current += 1
    controllerRef.current?.abort()
    router.push(`/prescription/history?date=${encodeURIComponent(value)}`, { scroll: true })
  }

  function handleSearchPageChange(page: number) {
    const normalized = query.trim()
    if (!normalized || page < 1 || page > (searchData?.pagination.totalPages || 1)) return
    setSearchPage(page)
    updateUrl(normalized, page)
    void loadSearch(normalized, page)
  }

  const isSearching = Boolean(query.trim())
  const datePickerValue = /^\d{4}-\d{2}-\d{2}$/u.test(query.trim()) ? query.trim() : ''

  return (
    <>
      <form className="prescription-history-search" role="search" onSubmit={handleSubmit}>
        <label htmlFor="prescription-history-query">搜索历史处方</label>
        <div className="prescription-history-search-controls">
          <input
            id="prescription-history-query"
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="搜索日期、歌名或歌词"
            autoComplete="off"
          />
          <button type="submit" aria-label="搜索历史处方">⌕</button>
          <label className="prescription-history-date-picker" aria-label="按日期选择历史处方">
            <span aria-hidden="true">▣</span>
            <input type="date" value={datePickerValue} onChange={(event) => handleDateChange(event.target.value)} />
          </label>
        </div>
      </form>

      {isSearching ? (
        <section className="prescription-history-search-results" aria-live="polite">
          {searchStatus === 'loading' ? <p className="prescription-history-search-status">正在搜索…</p> : null}
          {searchStatus === 'error' ? <p className="prescription-history-search-status is-error">搜索暂时失败，请稍后再试。</p> : null}
          {searchStatus === 'empty' ? (
            <div className="prescription-history-search-empty">
              <p>没有找到相关历史处方</p>
              <small>试试搜索日期、歌名或歌词中的关键词。</small>
            </div>
          ) : null}
          {searchStatus === 'success' && searchData ? (
            focusedDateKey ? (
              searchData.records[0] ? <FocusedHistoryRecord record={searchData.records[0]} /> : null
            ) : (
              <>
                <p className="prescription-history-search-count">搜索结果 {searchData.pagination.total}</p>
                <div className="prescription-history-search-list">
                  {searchData.records.map((record) => (
                    <Link key={record.id} href={getSearchResultHref(record.dateKey)} className="prescription-history-search-result">
                      <time dateTime={record.dateKey}>{formatDate(record.dateKey)}</time>
                      <strong>{record.lyric ? `《${record.lyric.songTitle}》` : '当日处方'}</strong>
                      {record.lyricSnippet ? <span>{record.lyricSnippet}</span> : null}
                    </Link>
                  ))}
                </div>
                {searchData.pagination.totalPages > 1 ? (
                  <nav className="prescription-history-search-pagination" aria-label="历史处方搜索结果分页">
                    <button type="button" disabled={!searchData.pagination.hasPrevious} onClick={() => handleSearchPageChange(searchPage - 1)}>上一页</button>
                    <span>{searchData.pagination.page} / {searchData.pagination.totalPages}</span>
                    <button type="button" disabled={!searchData.pagination.hasNext} onClick={() => handleSearchPageChange(searchPage + 1)}>下一页</button>
                  </nav>
                ) : null}
              </>
            )
          ) : null}
        </section>
      ) : children}
    </>
  )
}
