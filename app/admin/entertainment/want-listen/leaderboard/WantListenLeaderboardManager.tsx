'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Mode = 'WANT_LISTEN' | 'CANTONESE_FRAGMENT' | 'FALSE_TITLE'
type ModeOverview = {
  mode: Mode
  label: string
  total: number
  todayCount: number
  weekCount: number
  topUser: { id: string; uid: number; nickname: string; avatarUrl: string } | null
  topScore: number | null
  lastUpdatedAt: string | null
}
type Overview = { overview: ModeOverview[]; totalAll: number; generatedAt: string }
type UserScore = { mode: Mode; label: string; score: number; correctCount: number; completionTimeMs: number | null; achievedAt: string | null }
type UserResult = {
  user: { id: string; uid: number; nickname: string; avatarUrl: string }
  totalEntries: number
  scores: UserScore[]
}
type ClearResult = {
  action: 'CLEAR_ALL' | 'CLEAR_MODE' | 'CLEAR_USER'
  deletedCount: number
  beforeCount: number
  mode: Mode | null
  targetUserId: string | null
  operatedAt: string
  admin: { uid: number; nickname: string }
}
type BonusRow = {
  id: string
  userId: string
  uid: number
  displayName: string
  mode: Mode
  periodType: 'DAY' | 'WEEK' | 'ALL'
  periodKey: string
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number | null
  achievedAt: string
  sessionId: string | null
  sessionStatus: string | null
}
type BonusListResponse = { mode: Mode; periodType: 'DAY' | 'WEEK' | 'ALL'; periodKey: string; rows: BonusRow[] }
type BonusResult = {
  mode: Mode
  before: Array<{ periodType: string; periodKey: string; score: number }>
  after: Array<{ periodType: string; periodKey: string; score: number }>
  applied: boolean
  sourceSessionId: string | null
  operatedAt: string
  admin: { uid: number; nickname: string }
}
type SessionRead = {
  id: string
  userId: string
  mode: Mode
  status: string
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number | null
  startedAt: string
  completedAt: string | null
  lastActiveAt: string
  antiCheatStatus: string
  user: { id: string; uid: number; nickname: string; avatarUrl: string }
}

const MODE_LABELS: Record<Mode, string> = {
  WANT_LISTEN: '想听',
  CANTONESE_FRAGMENT: '粤语残片',
  FALSE_TITLE: '防不胜防',
}

const CLEAR_ALL_CONFIRM = `确认清空全部想听排行榜数据？

该操作只删除排行榜成绩，不会删除：
- 用户数据
- 游戏记录
- 成就
- 反作弊日志

删除后用户需要重新挑战进入排行榜。`

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '操作失败')
  return payload.data
}

export function WantListenLeaderboardManager() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [userQuery, setUserQuery] = useState('')
  const [userResult, setUserResult] = useState<UserResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // 补分（复用听听排行榜补分的行卡片 + 内联表单布局）
  const [bonusMode, setBonusMode] = useState<Mode>('WANT_LISTEN')
  const [bonusPeriod, setBonusPeriod] = useState<'DAY' | 'WEEK' | 'ALL'>('WEEK')
  const [bonusQuery, setBonusQuery] = useState('')
  const [bonusRows, setBonusRows] = useState<BonusRow[]>([])
  const [bonusLoading, setBonusLoading] = useState(false)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [bonusScore, setBonusScore] = useState(100)
  const [bonusCorrectCount, setBonusCorrectCount] = useState(0)
  const [bonusMaxStreak, setBonusMaxStreak] = useState(0)
  const [bonusTotalQuestions, setBonusTotalQuestions] = useState(0)
  const [bonusCompletionTimeMs, setBonusCompletionTimeMs] = useState('')
  const [bonusAchievedAt, setBonusAchievedAt] = useState(() => {
    const value = new Date()
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
    return value.toISOString().slice(0, 16)
  })
  const [bonusReason, setBonusReason] = useState('')
  const [bonusBusyKey, setBonusBusyKey] = useState('')
  const [sessionIdInput, setSessionIdInput] = useState('')
  const [sessionRead, setSessionRead] = useState<SessionRead | null>(null)
  const [sessionReading, setSessionReading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setOverview(await request<Overview>('/api/admin/entertainment/want-listen/leaderboard'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排行榜加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function searchUser(event: FormEvent) {
    event.preventDefault()
    if (!userQuery.trim()) return
    setSearching(true)
    setError('')
    setMessage('')
    try {
      setUserResult(await request<UserResult>(`/api/admin/entertainment/want-listen/leaderboard?view=user&q=${encodeURIComponent(userQuery.trim())}`))
    } catch (reason) {
      setUserResult(null)
      setError(reason instanceof Error ? reason.message : '用户查询失败')
    } finally {
      setSearching(false)
    }
  }

  async function clearLeaderboard(kind: 'CLEAR_ALL' | 'CLEAR_MODE' | 'CLEAR_USER', mode?: Mode, targetUserId?: string) {
    if (busy) return
    const label = kind === 'CLEAR_ALL' ? '全部' : kind === 'CLEAR_MODE' ? MODE_LABELS[mode as Mode] : '该用户'
    let confirmed = false
    if (kind === 'CLEAR_ALL') {
      confirmed = window.confirm(CLEAR_ALL_CONFIRM)
    } else if (kind === 'CLEAR_MODE') {
      confirmed = window.confirm(`确认清空「${MODEL_LABEL(mode as Mode)}」排行榜？\n\n该操作只删除该模式的排行榜成绩，不影响其他模式与用户数据。`)
    } else {
      confirmed = window.confirm(`确认清除该用户的所有想听排行榜成绩？\n\n只删除排行榜成绩，保留游戏历史、成就、统计与反作弊日志。`)
    }
    if (!confirmed) return
    const reason = window.prompt('请填写清除原因（必填）')
    if (!reason || !reason.trim()) {
      setError('清除已取消：必须填写清除原因')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await request<ClearResult>('/api/admin/entertainment/want-listen/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: kind,
          ...(mode ? { mode } : {}),
          ...(targetUserId ? { targetUserId } : {}),
          reason: reason.trim(),
        }),
      })
      const actionLabel = kind === 'CLEAR_ALL' ? '全部排行榜' : kind === 'CLEAR_MODE' ? `「${MODEL_LABEL(mode as Mode)}」排行榜` : `用户排行榜`
      setMessage(`已清空${actionLabel}：删除 ${result.deletedCount} 条成绩，操作时间 ${new Date(result.operatedAt).toLocaleString()}，管理员 ${result.admin.nickname}（UID ${result.admin.uid}）`)
      setUserResult(null)
      void load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  const cardClass = 'rounded-xl border border-brand-100 bg-white p-5 shadow-sm'
  const buttonBase = 'rounded-lg px-3 py-2 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50'

  // ---------- 排行榜补分（复用听听补分的行卡片 + 内联表单交互） ----------
  const loadBonus = useCallback(async () => {
    setBonusLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'rows', mode: bonusMode, period: bonusPeriod, q: bonusQuery.trim() })
      const data = await request<BonusListResponse>(`/api/admin/entertainment/want-listen/leaderboard?${params}`)
      setBonusRows(data.rows)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '榜单加载失败')
    } finally {
      setBonusLoading(false)
    }
  }, [bonusMode, bonusPeriod, bonusQuery])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBonus(), bonusQuery ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [loadBonus, bonusQuery])

  function openBonus(row: BonusRow) {
    setAdjustingId(row.id)
    setBonusScore(row.score)
    setBonusCorrectCount(row.correctCount)
    setBonusMaxStreak(row.maxStreak)
    setBonusTotalQuestions(row.totalQuestions)
    setBonusCompletionTimeMs(row.completionTimeMs !== null ? String(row.completionTimeMs) : '')
    const value = new Date(row.achievedAt)
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
    setBonusAchievedAt(value.toISOString().slice(0, 16))
    setBonusReason('')
    setSessionIdInput('')
    setSessionRead(null)
    setMessage('')
    setError('')
  }

  async function readSession() {
    const sessionId = sessionIdInput.trim()
    if (!sessionId) {
      setError('请先输入要读取的 Session ID')
      return
    }
    setSessionReading(true)
    setError('')
    try {
      const data = await request<SessionRead>(`/api/admin/entertainment/want-listen/leaderboard?view=session&sessionId=${encodeURIComponent(sessionId)}`)
      setSessionRead(data)
      setBonusScore(data.score)
      setBonusCorrectCount(data.correctCount)
      setBonusMaxStreak(data.maxStreak)
      setBonusTotalQuestions(data.totalQuestions)
      setBonusCompletionTimeMs(data.completionTimeMs !== null ? String(data.completionTimeMs) : '')
      const achievedAtValue = data.completedAt || data.lastActiveAt || data.startedAt
      const value = new Date(achievedAtValue)
      value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
      setBonusAchievedAt(value.toISOString().slice(0, 16))
      setMessage(`已读取游戏记录：${data.user.nickname}（UID ${data.user.uid}）· ${MODE_LABELS[data.mode]} · ${data.score} 分 · ${data.status}`)
    } catch (requestError) {
      setSessionRead(null)
      setError(requestError instanceof Error ? requestError.message : '读取游戏记录失败')
    } finally {
      setSessionReading(false)
    }
  }

  async function submitBonus(row: BonusRow) {
    if (!bonusScore || bonusScore <= 0) {
      setError('请输入有效的补分成绩')
      return
    }
    if (bonusReason.trim().length < 2) {
      setError('请填写补分原因')
      return
    }
    const key = `bonus:${row.id}`
    setBonusBusyKey(key)
    setError('')
    setMessage('')
    try {
      const result = await request<BonusResult>('/api/admin/entertainment/want-listen/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_SCORE',
          userId: row.userId,
          mode: bonusMode,
          period: bonusPeriod,
          score: bonusScore,
          correctCount: bonusCorrectCount,
          maxStreak: bonusMaxStreak,
          totalQuestions: bonusTotalQuestions,
          completionTimeMs: bonusCompletionTimeMs === '' ? undefined : bonusCompletionTimeMs,
          achievedAt: bonusAchievedAt,
          sourceSessionId: sessionRead?.id || undefined,
          reason: bonusReason.trim(),
        }),
      })
      if (result.applied) {
        const summary = result.after.map((item) => `${item.periodType === 'DAY' ? '今日' : item.periodType === 'WEEK' ? '本周' : '全部'}榜 ${item.score} 分`).join('、')
        setMessage(`补分成功：${result.mode === 'WANT_LISTEN' ? '想听' : result.mode === 'CANTONESE_FRAGMENT' ? '粤语残片' : '防不胜防'} → ${summary}（管理员 ${result.admin.nickname}）`)
      } else {
        setMessage('未覆盖：该用户已有更高或相同成绩，补分成绩保持不变。')
      }
      setAdjustingId(null)
      await loadBonus()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '补分失败')
    } finally {
      setBonusBusyKey('')
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
      {message ? <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{message}</div> : null}

      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-brand-950">排行榜总览</h2>
            <p className="mt-1 text-sm text-brand-600">总计 {overview?.totalAll ?? '—'} 条排行榜成绩</p>
          </div>
          <button
            type="button"
            onClick={() => { void clearLeaderboard('CLEAR_ALL') }}
            disabled={busy || loading}
            className={`${buttonBase} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
          >
            清空全部排行榜
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-brand-500">加载中…</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {overview?.overview.map((item) => (
              <div key={item.mode} className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-brand-900">{item.label}</h3>
                  <button
                    type="button"
                    onClick={() => { void clearLeaderboard('CLEAR_MODE', item.mode) }}
                    disabled={busy}
                    className={`${buttonBase} border border-brand-200 bg-white text-brand-700 hover:bg-brand-100`}
                  >
                    清空
                  </button>
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-brand-500">记录数量</dt><dd className="font-bold text-brand-900">{item.total}</dd></div>
                  <div className="flex justify-between"><dt className="text-brand-500">今日新增</dt><dd className="font-bold text-brand-900">{item.todayCount}</dd></div>
                  <div className="flex justify-between"><dt className="text-brand-500">本周新增</dt><dd className="font-bold text-brand-900">{item.weekCount}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="shrink-0 text-brand-500">最高分用户</dt><dd className="truncate text-right font-bold text-brand-900">{item.topUser ? `${item.topUser.nickname}（UID ${item.topUser.uid}）` : '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-brand-500">最高分</dt><dd className="font-bold text-brand-900">{item.topScore ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-brand-500">最近更新</dt><dd className="font-bold text-brand-900">{item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toLocaleString() : '—'}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-lg font-black text-brand-950">清除指定用户排行榜</h2>
        <p className="mt-1 text-sm text-brand-600">输入 UID 或昵称查询用户，确认后清除其所有想听排行榜成绩（只删排行榜，保留游戏历史/成就/统计/反作弊日志）。</p>
        <form onSubmit={searchUser} className="mt-4 flex gap-2">
          <input
            value={userQuery}
            onChange={(event) => setUserQuery(event.target.value)}
            placeholder="输入 UID 或用户昵称"
            className="w-full max-w-sm rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
          />
          <button type="submit" disabled={searching || !userQuery.trim()} className={`${buttonBase} border border-brand-200 bg-white text-brand-700 hover:bg-brand-100`}>
            {searching ? '查询中…' : '查询用户'}
          </button>
        </form>

        {userResult ? (
          <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50/50 p-4">
            <div className="flex flex-wrap items-center gap-4">
              {userResult.user.avatarUrl
                ? <img src={userResult.user.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                : <div className="h-12 w-12 rounded-full bg-brand-200" />}
              <div>
                <p className="font-black text-brand-900">{userResult.user.nickname}</p>
                <p className="text-sm text-brand-600">UID {userResult.user.uid} · 排行榜记录 {userResult.totalEntries} 条</p>
              </div>
              <button
                type="button"
                onClick={() => { void clearLeaderboard('CLEAR_USER', undefined, userResult.user.id) }}
                disabled={busy || userResult.totalEntries === 0}
                className={`${buttonBase} ml-auto border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
              >
                清除该用户排行榜
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {userResult.scores.map((score) => (
                <div key={score.mode} className="rounded-lg border border-brand-100 bg-white p-3 text-sm">
                  <p className="font-black text-brand-900">{score.label}</p>
                  <p className="mt-1 text-brand-600">最高分：<span className="font-bold text-brand-900">{score.score}</span></p>
                  <p className="text-brand-600">答对：{score.correctCount}</p>
                  <p className="text-brand-600">完成时间：{score.completionTimeMs !== null ? `${Math.round(score.completionTimeMs / 1000)} 秒` : '—'}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* 排行榜补分：布局与交互直接复用「听听排行榜补分」（行卡片 + 内联展开表单） */}
      <section className="mt-8 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Leaderboard Admin</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">排行榜分数补录</h2>
            <p className="mt-1 text-sm text-slate-500">补录「成绩发生时间」对应的当日 / 本周 / 全部榜最高成绩；已有更高成绩时不会覆盖。可从异常游戏记录读取自动填入。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={bonusMode} onChange={(event) => setBonusMode(event.target.value as Mode)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {(Object.keys(MODE_LABELS) as Mode[]).map((value) => <option key={value} value={value}>{MODE_LABELS[value]}</option>)}
            </select>
            <select value={bonusPeriod} onChange={(event) => setBonusPeriod(event.target.value as 'DAY' | 'WEEK' | 'ALL')} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="DAY">今日榜</option>
              <option value="WEEK">本周榜</option>
              <option value="ALL">全部榜</option>
            </select>
            <input value={bonusQuery} onChange={(event) => setBonusQuery(event.target.value)} placeholder="搜索用户名 / UID" className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>

        {bonusLoading ? <p className="mt-4 text-sm text-slate-500">正在加载榜单…</p> : null}
        {!bonusLoading && !bonusRows.length ? <p className="mt-4 text-sm text-slate-500">当前筛选没有榜单成绩，可在下方按用户查询后补录，或直接读取游戏记录。</p> : null}

        <div className="mt-4 space-y-3">
          {bonusRows.map((row, index) => {
            const busy = bonusBusyKey === `bonus:${row.id}`
            const adjusting = adjustingId === row.id
            return (
              <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <strong className="w-8 text-center text-slate-400">#{index + 1}</strong>
                    <div>
                      <p className="font-black text-slate-900">{row.displayName} <span className="font-normal text-slate-400">UID {row.uid}</span></p>
                      <p className="text-xs text-slate-500">{row.score} 分 · 答对 {row.correctCount} · 最高连击 {row.maxStreak} · 完成 {row.totalQuestions} 题 · {row.sessionStatus || '—'}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => adjusting ? setAdjustingId(null) : openBonus(row)} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{adjusting ? '取消补录' : '补录成绩'}</button>
                </div>
                {adjusting ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-brand-100 bg-white p-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
                    <label className="text-xs font-bold text-slate-600">最终成绩<input type="number" min={1} max={10000000} step={1} inputMode="numeric" value={bonusScore} onChange={(event) => setBonusScore(Number(event.target.value))} className="mt-1 block w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                    <label className="text-xs font-bold text-slate-600">成绩发生时间<input type="datetime-local" value={bonusAchievedAt} onChange={(event) => setBonusAchievedAt(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                    <label className="text-xs font-bold text-slate-600">原因<input value={bonusReason} onChange={(event) => setBonusReason(event.target.value)} maxLength={200} placeholder="系统异常未结算" className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                    <button type="button" onClick={() => void submitBonus(row)} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? '处理中…' : '确认补录'}</button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>

        {/* 从异常游戏记录读取：读取后自动填入补录表单 */}
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-slate-600">从游戏记录读取
              <input value={sessionIdInput} onChange={(event) => setSessionIdInput(event.target.value)} placeholder="输入 Session ID" className="mt-1 block w-72 rounded-lg border border-slate-200 px-2 py-2 text-sm" />
            </label>
            <button type="button" onClick={() => void readSession()} disabled={sessionReading || !sessionIdInput.trim()} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{sessionReading ? '读取中…' : '读取'}</button>
          </div>
          {sessionRead ? (
            <p className="mt-2 text-sm text-slate-600">
              {sessionRead.user.nickname}（UID {sessionRead.user.uid}）· {MODE_LABELS[sessionRead.mode]} · <b>{sessionRead.score}</b> 分 · 答对 {sessionRead.correctCount} · 连击 {sessionRead.maxStreak} · {sessionRead.status} · 已完成：{sessionRead.completedAt ? new Date(sessionRead.completedAt).toLocaleString() : '—'}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function MODEL_LABEL(mode: Mode) {
  return MODE_LABELS[mode]
}
