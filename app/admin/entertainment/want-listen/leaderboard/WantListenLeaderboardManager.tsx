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
    </div>
  )
}

function MODEL_LABEL(mode: Mode) {
  return MODE_LABELS[mode]
}
