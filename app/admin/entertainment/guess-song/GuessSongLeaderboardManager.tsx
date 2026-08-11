'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'EXPERT'
type Period = 'WEEK' | 'MONTH'
type Row = {
  id: string
  entryIds: string[]
  userId: string
  uid: number
  displayName: string
  username: string
  mode: Mode
  periodType: Period
  periodKey: string
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: string
  sessionStatus: string
}
type ListResponse = { mode: Mode; periodType: Period; periodKey: string; rows: Row[] }
type AddResponse = {
  compensation: { baseScore: number; comboBonus: number; totalScore: number }
  beforeScore: number
  afterScore: number
}

const modeLabels: Record<Mode, string> = { EASY: '简单', ADVANCED: '进阶', HARD: '困难', EXPERT: '专家' }
const periods: Array<{ value: Period; label: string }> = [
  { value: 'WEEK', label: '本周榜' },
  { value: 'MONTH', label: '本月榜' },
]

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '操作失败')
  return payload.data
}

export function GuessSongLeaderboardManager() {
  const [mode, setMode] = useState<Mode>('EASY')
  const [period, setPeriod] = useState<Period>('WEEK')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [periodKey, setPeriodKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [correctAnswers, setCorrectAnswers] = useState(1)
  const [startingStreak, setStartingStreak] = useState(0)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ mode, period, q: query.trim() })
      const data = await request<ListResponse>(`/api/admin/entertainment/guess-song/leaderboard?${params}`)
      setRows(data.rows)
      setPeriodKey(data.periodKey)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '排行榜加载失败')
    } finally {
      setLoading(false)
    }
  }, [mode, period, query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const selectedRow = rows.find((row) => row.id === adjustingId) || null
  const streakOptions = useMemo(() => {
    const values = new Set<number>([0, 10, 20, 30, 50, 100])
    if (selectedRow) values.add(selectedRow.maxStreak)
    return [...values].filter((value) => value >= 0 && value <= 1000).sort((a, b) => a - b)
  }, [selectedRow])

  function openAdjust(row: Row) {
    setAdjustingId(row.id)
    setCorrectAnswers(1)
    setStartingStreak(row.maxStreak)
    setReason('')
    setMessage('')
    setError('')
  }

  async function addScore(row: Row) {
    if (!reason.trim()) {
      setError('请填写补分原因')
      return
    }
    const key = `add:${row.id}`
    setBusyKey(key)
    setError('')
    setMessage('')
    try {
      const data = await request<AddResponse>('/api/admin/entertainment/guess-song/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_SCORE',
          userId: row.userId,
          mode,
          periodType: period,
          periodKey,
          correctAnswers,
          startingStreak,
          reason,
        }),
      })
      setMessage(`补分成功：+${data.compensation.totalScore} 分（基础 ${data.compensation.baseScore}，连击奖励 ${data.compensation.comboBonus}）`)
      setAdjustingId(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '补分失败')
    } finally {
      setBusyKey('')
    }
  }

  async function deleteScore(row: Row) {
    const confirmed = window.confirm(`确定删除：\n用户名 ${row.displayName}\n${modeLabels[mode]}模式\n当前成绩 ${row.score} 分？\n\n删除后只影响本周期该模式榜单。`)
    if (!confirmed) return
    const reasonText = window.prompt('请输入删除原因（必填）', '错误成绩删除')
    if (!reasonText?.trim()) return
    const key = `delete:${row.id}`
    setBusyKey(key)
    setError('')
    setMessage('')
    try {
      const data = await request<{ deletedCount: number }>('/api/admin/entertainment/guess-song/leaderboard', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: row.userId, mode, periodType: period, periodKey, reason: reasonText }),
      })
      setMessage(`已删除 ${data.deletedCount} 条${modeLabels[mode]}榜单成绩`)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除失败')
    } finally {
      setBusyKey('')
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Leaderboard Admin</p>
          <h2 className="mt-1 text-xl font-black text-slate-900">排行榜分数管理</h2>
          <p className="mt-1 text-sm text-slate-500">当前榜单模型为每个用户、模式、周期的最高单局成绩。补分只能按真实答对题数和连击计算。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={mode} onChange={(event) => setMode(event.target.value as Mode)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户名 / UID" className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
      </div>

      {message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700" role="alert">{error}</p> : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">正在加载榜单…</p> : null}
      {!loading && !rows.length ? <p className="mt-4 text-sm text-slate-500">当前筛选没有榜单成绩。</p> : null}

      <div className="mt-4 space-y-3">
        {rows.map((row, index) => {
          const busy = busyKey.endsWith(row.id)
          const adjusting = adjustingId === row.id
          return (
            <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <strong className="w-8 text-center text-slate-400">#{index + 1}</strong>
                  <div>
                    <p className="font-black text-slate-900">{row.displayName} <span className="font-normal text-slate-400">UID {row.uid}</span></p>
                    <p className="text-xs text-slate-500">{row.score} 分 · 答对 {row.correctCount} · 最高连击 {row.maxStreak} · {row.sessionStatus}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => adjusting ? setAdjustingId(null) : openAdjust(row)} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{adjusting ? '取消补分' : '补分'}</button>
                  <button type="button" onClick={() => void deleteScore(row)} disabled={busy} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50">删除成绩</button>
                </div>
              </div>
              {adjusting ? (
                <div className="mt-3 grid gap-2 rounded-lg border border-brand-100 bg-white p-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
                  <label className="text-xs font-bold text-slate-600">补回答对题数<select value={correctAnswers} onChange={(event) => setCorrectAnswers(Number(event.target.value))} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm">{Array.from({ length: 20 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} 题</option>)}</select></label>
                  <label className="text-xs font-bold text-slate-600">补分前连击<select value={startingStreak} onChange={(event) => setStartingStreak(Number(event.target.value))} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm">{streakOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label className="text-xs font-bold text-slate-600">原因<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="系统异常未结算" className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                  <button type="button" onClick={() => void addScore(row)} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? '处理中…' : '确认补分'}</button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
