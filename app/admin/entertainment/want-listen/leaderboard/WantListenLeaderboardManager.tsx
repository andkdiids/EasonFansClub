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
type UserScore = { mode: Mode; label: string; score: number; correctCount: number; maxStreak: number | null; completionTimeMs: number | null; achievedAt: string | null }
type RecoverableSession = {
  id: string
  mode: Mode
  status: string
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  currentStreak: number
  wrongCount: number
  startedAt: string
  lastActiveAt: string
  antiCheatStatus: string
}
type UserResult = {
  user: { id: string; uid: number; nickname: string; avatarUrl: string }
  totalEntries: number
  scores: UserScore[]
  recoverableSessions: RecoverableSession[]
}
type ClearResult = {
  action: 'CLEAR_ALL' | 'CLEAR_MODE' | 'CLEAR_USER'
  deletedCount: number
  beforeCount: number
  excludedSessionCount: number
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
  maxStreak: number | null
  totalQuestions: number
  completionTimeMs: number | null
  achievedAt: string
  sessionId: string | null
  sessionStatus: string | null
}
type BonusListResponse = { mode: Mode; periodType: 'DAY' | 'WEEK' | 'ALL'; periodKey: string; rows: BonusRow[] }
type ScoreState = { score: number; correctCount: number; maxStreak: number; totalQuestions: number }
type Compensation = {
  correctAnswers: number
  startingStreak: number
  endStreak: number
  baseScore: number
  comboBonus: number
  milestones: number
  totalScore: number
}
type BackfillResult = {
  type: 'SESSION_RECOVERY' | 'MANUAL_QUESTION_ADJUSTMENT'
  dryRun: boolean
  applied?: boolean
  mode: Mode
  sessionId: string | null
  before: ScoreState
  after: ScoreState
  afterScore: number
  afterCorrect: number
  afterTotal: number
  afterMaxStreak: number
  correctDelta?: number
  wrongDelta?: number
  startingStreak?: number
  compensation?: Compensation
  affectedPeriods: Array<{ periodType: 'DAY' | 'WEEK' | 'ALL'; periodKey: string }>
  leaderboardUpdated?: boolean
  playedAt: string
  reason: string
  operatedAt?: string
  admin?: { uid: number; nickname: string }
}
type SessionRead = {
  id: string
  userId: string
  mode: Mode
  status: string
  score: number
  correctCount: number
  maxStreak: number
  currentStreak: number
  wrongCount: number
  livesRemaining: number
  totalQuestions: number
  completionTimeMs: number | null
  startedAt: string
  completedAt: string | null
  lastActiveAt: string
  antiCheatStatus: string
  user: { id: string; uid: number; nickname: string; avatarUrl: string }
}

type DeleteResult = {
  deletedSessionId: string
  mode: Mode
  before: ScoreState
  periodsAffected: Array<{ periodType: 'DAY' | 'WEEK' | 'ALL'; periodKey: string }>
  after: Array<{ periodType: string; periodKey: string; score: number | null }>
  targetUserId: string
  uid: number
  nickname: string
  reason: string
}

const MODE_LABELS: Record<Mode, string> = {
  WANT_LISTEN: '想听',
  CANTONESE_FRAGMENT: '粤语残片',
  FALSE_TITLE: '防不胜防',
}

const PERIOD_LABELS: Record<'DAY' | 'WEEK' | 'ALL', string> = {
  DAY: '今日榜',
  WEEK: '本周榜',
  ALL: '全部榜',
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

function toDateTimeLocal(value: string) {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
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
  // 补录（异常游戏恢复优先，人工补题次之；不允许直接填写分数）
  const [bonusMode, setBonusMode] = useState<Mode>('WANT_LISTEN')
  const [bonusPeriod, setBonusPeriod] = useState<'DAY' | 'WEEK' | 'ALL'>('WEEK')
  const [bonusQuery, setBonusQuery] = useState('')
  const [bonusRows, setBonusRows] = useState<BonusRow[]>([])
  const [bonusLoading, setBonusLoading] = useState(false)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [backfillType, setBackfillType] = useState<'SESSION_RECOVERY' | 'MANUAL_QUESTION_ADJUSTMENT'>('SESSION_RECOVERY')
  const [recoverableSessions, setRecoverableSessions] = useState<RecoverableSession[]>([])
  const [recoverableLoading, setRecoverableLoading] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [manualCorrectDelta, setManualCorrectDelta] = useState(10)
  const [manualWrongDelta, setManualWrongDelta] = useState(0)
  const [manualStartingStreak, setManualStartingStreak] = useState(0)
  const [bonusAchievedAt, setBonusAchievedAt] = useState(() => {
    const value = new Date()
    value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
    return value.toISOString().slice(0, 16)
  })
  const [bonusReason, setBonusReason] = useState('')
  const [bonusBusyKey, setBonusBusyKey] = useState('')
  const [preview, setPreview] = useState<BackfillResult | null>(null)
  const [sessionIdInput, setSessionIdInput] = useState('')
  const [sessionRead, setSessionRead] = useState<SessionRead | null>(null)
  const [sessionReading, setSessionReading] = useState(false)
  // 精确删除某用户的单条排行榜成绩（标记 source Session 排除，而不是清空整个排行榜）
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

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
      confirmed = window.confirm(`确认清空「${MODE_LABELS[mode as Mode]}」排行榜？\n\n该操作只删除该模式的排行榜成绩，不影响其他模式与用户数据。`)
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
      const actionLabel = kind === 'CLEAR_ALL' ? '全部排行榜' : kind === 'CLEAR_MODE' ? `「${MODE_LABELS[mode as Mode]}」排行榜` : `用户排行榜`
      setMessage(`已清空${actionLabel}：删除 ${result.deletedCount} 条榜单投影，排除 ${result.excludedSessionCount} 局历史成绩；操作时间 ${new Date(result.operatedAt).toLocaleString()}，管理员 ${result.admin.nickname}（UID ${result.admin.uid}）`)
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

  // ---------- 排行榜补录 ----------
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

  async function loadRecoverable(userId: string, defaultSelect = false) {
    setRecoverableLoading(true)
    try {
      const data = await request<{ sessions: RecoverableSession[] }>(
        `/api/admin/entertainment/want-listen/leaderboard?view=recoverable&userId=${encodeURIComponent(userId)}&mode=${encodeURIComponent(bonusMode)}`,
      )
      setRecoverableSessions(data.sessions)
      if (defaultSelect && data.sessions.length) setSelectedSessionId(data.sessions[0].id)
    } catch (requestError) {
      setRecoverableSessions([])
      setError(requestError instanceof Error ? requestError.message : '加载异常游戏记录失败')
    } finally {
      setRecoverableLoading(false)
    }
  }

  function openBonus(row: BonusRow) {
    setAdjustingId(row.id)
    setBackfillType('SESSION_RECOVERY')
    setSelectedSessionId('')
    setManualCorrectDelta(10)
    setManualWrongDelta(0)
    setManualStartingStreak(0)
    setBonusAchievedAt(toDateTimeLocal(row.achievedAt))
    setBonusReason('')
    setPreview(null)
    setSessionIdInput('')
    setSessionRead(null)
    setMessage('')
    setError('')
    void loadRecoverable(row.userId, true)
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
      setSelectedSessionId(data.id)
      setMessage(`已读取游戏记录：${data.user.nickname}（UID ${data.user.uid}）· ${MODE_LABELS[data.mode]} · ${data.score} 分 · ${data.status}`)
    } catch (requestError) {
      setSessionRead(null)
      setError(requestError instanceof Error ? requestError.message : '读取游戏记录失败')
    } finally {
      setSessionReading(false)
    }
  }

  function submitBackfill(method: 'preview' | 'apply', row: BonusRow) {
    if (backfillType === 'MANUAL_QUESTION_ADJUSTMENT' && (method === 'preview' || method === 'apply')) {
      if (manualCorrectDelta < 1) {
        setError('补回答对题数必须至少为 1')
        return
      }
      if (bonusReason.trim().length < 2) {
        setError('请填写补录原因')
        return
      }
    }
    if (backfillType === 'SESSION_RECOVERY' && !selectedSessionId.trim()) {
      setError('请先选择要恢复的异常游戏记录')
      return
    }
    const key = `bonus:${row.id}:${method}`
    setBonusBusyKey(key)
    setError('')
    setMessage('')
    void (async () => {
      try {
        const result = await request<BackfillResult>('/api/admin/entertainment/want-listen/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: method === 'preview' ? 'PREVIEW_BACKFILL' : 'BACKFILL',
            userId: row.userId,
            mode: bonusMode,
            type: backfillType,
            sessionId: backfillType === 'SESSION_RECOVERY' ? selectedSessionId.trim() : undefined,
            correctDelta: backfillType === 'MANUAL_QUESTION_ADJUSTMENT' ? manualCorrectDelta : undefined,
            wrongDelta: backfillType === 'MANUAL_QUESTION_ADJUSTMENT' ? manualWrongDelta : undefined,
            startingStreak: backfillType === 'MANUAL_QUESTION_ADJUSTMENT' ? manualStartingStreak : undefined,
            playedAt: bonusAchievedAt,
            reason: bonusReason.trim(),
          }),
        })
        if (method === 'preview') {
          setPreview(result)
        } else {
          if (result.type === 'SESSION_RECOVERY') {
            setMessage(`恢复成功：${result.mode === 'WANT_LISTEN' ? '想听' : result.mode === 'CANTONESE_FRAGMENT' ? '粤语残片' : '防不胜防'} 采用异常游戏记录 ${result.after.score} 分${result.leaderboardUpdated === false ? '（已有更高成绩，排行榜保持不变）' : ''}，管理员 ${result.admin?.nickname ?? ''}`)
          } else {
            const summary = result.affectedPeriods.map((item) => `${PERIOD_LABELS[item.periodType]} ${result.afterScore} 分`).join('、')
            setMessage(`补录成功：${result.mode === 'WANT_LISTEN' ? '想听' : result.mode === 'CANTONESE_FRAGMENT' ? '粤语残片' : '防不胜防'} → ${summary}（管理员 ${result.admin?.nickname ?? ''}）`)
          }
          setAdjustingId(null)
          setPreview(null)
          await loadBonus()
          if (userResult) void searchUser({ preventDefault: () => undefined } as FormEvent)
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '补录失败')
      } finally {
        setBonusBusyKey('')
      }
    })()
  }

  function renderAffectedPeriods(preview: BackfillResult) {
    return preview.affectedPeriods.map((item) => PERIOD_LABELS[item.periodType]).join('、')
  }

  function renderScoreRow(label: string, state: ScoreState) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs leading-5">
        <p className="font-black text-slate-500">{label}</p>
        <p className="mt-0.5 font-bold text-slate-800">分数 {state.score} · 答对 {state.correctCount} · 完成 {state.totalQuestions} · 最高连击 {state.maxStreak}</p>
      </div>
    )
  }

  function renderBackfillPreview() {
    if (!preview) return null
    const compensation = preview.compensation
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-slate-700">
        {renderScoreRow('当前成绩', preview.before)}
        <div className="flex items-center gap-2 px-1 text-emerald-600">
          <span>↓ 补录后</span>
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-black">
            分数 +{preview.afterScore - preview.before.score} · 答对 +{preview.afterCorrect - preview.before.correctCount} · 完成 +{preview.afterTotal - preview.before.totalQuestions}
          </span>
        </div>
        {renderScoreRow('补录后成绩（同一局完整记录）', preview.after)}
        {compensation ? (
          <p className="px-1">计分明细：基础分 {compensation.baseScore} + 连击奖励 {compensation.comboBonus}（跨越 {compensation.milestones} 个连击节点，结束连击 {compensation.endStreak}），共新增 {compensation.totalScore} 分</p>
        ) : null}
        <p className="px-1">归属榜单：{renderAffectedPeriods(preview)} · 成绩发生时间 {new Date(preview.playedAt).toLocaleString()}</p>
        {preview.type === 'SESSION_RECOVERY'
          ? <p className="px-1">方式：异常游戏恢复（SESSION_RECOVERY）{preview.leaderboardUpdated === false ? '· 已有更高成绩，排行榜不会变化' : '· 将写入排行榜'}</p>
          : <p className="px-1">方式：人工补题（MANUAL_QUESTION_ADJUSTMENT）{preview.sessionId ? `· 基于游戏记录 ${preview.sessionId.slice(0, 8)}…` : ''}</p>}
      </div>
    )
  }

  function renderBackfillForm(row: BonusRow) {
    const busy = bonusBusyKey.startsWith(`bonus:${row.id}`)
    return (
      <div className="mt-3 rounded-lg border border-brand-100 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-slate-600">补录方式</span>
          <button type="button" onClick={() => { setBackfillType('SESSION_RECOVERY'); setPreview(null) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${backfillType === 'SESSION_RECOVERY' ? 'bg-brand-700 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            从异常游戏恢复
          </button>
          <button type="button" onClick={() => { setBackfillType('MANUAL_QUESTION_ADJUSTMENT'); setPreview(null) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${backfillType === 'MANUAL_QUESTION_ADJUSTMENT' ? 'bg-brand-700 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            人工补题
          </button>
        </div>

        {backfillType === 'SESSION_RECOVERY' ? (
          <div className="mt-3">
            <p className="text-xs font-bold text-slate-600">优先：该用户异常中断的游戏记录（直接采用记录内的真实成绩，不重新计算）</p>
            {recoverableLoading ? <p className="mt-2 text-xs text-slate-500">加载异常游戏记录…</p> : null}
            {!recoverableLoading && !recoverableSessions.length ? (
              <p className="mt-2 text-xs text-slate-500">该用户当前没有异常中断的游戏记录，请切换到「人工补题」或通过 Session ID 直接读取。</p>
            ) : null}
            <div className="mt-2 space-y-2">
              {recoverableSessions.map((session) => (
                <label key={session.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2 text-xs ${selectedSessionId === session.id ? 'border-brand-400 bg-brand-50' : 'border-slate-200 bg-white'}`}>
                  <input type="radio" name={`recover-${row.id}`} checked={selectedSessionId === session.id} onChange={() => { setSelectedSessionId(session.id); setPreview(null) }} className="mt-0.5" />
                  <span className="flex-1">
                    <span className="font-black text-slate-800">{MODE_LABELS[session.mode]} · {session.status} · {session.score} 分</span>
                    <span className="mt-0.5 block text-slate-500">
                      答对 {session.correctCount} · 完成 {session.totalQuestions} · 最高连击 {session.maxStreak} · 当前连击 {session.currentStreak} · 最近活跃 {new Date(session.lastActiveAt).toLocaleString()}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs font-bold text-slate-600">或输入 Session ID
                <input value={sessionIdInput} onChange={(event) => setSessionIdInput(event.target.value)} placeholder="输入 Session ID" className="mt-1 block w-72 rounded-lg border border-slate-200 px-2 py-2 text-sm" />
              </label>
              <button type="button" onClick={() => void readSession()} disabled={sessionReading || !sessionIdInput.trim()} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{sessionReading ? '读取中…' : '读取并选用'}</button>
            </div>
            {sessionRead && selectedSessionId === sessionRead.id ? (
              <p className="mt-2 text-xs text-slate-600">已选用：{sessionRead.user.nickname}（UID {sessionRead.user.uid}）· {MODE_LABELS[sessionRead.mode]} · <b>{sessionRead.score}</b> 分 · 答对 {sessionRead.correctCount} · 最高连击 {sessionRead.maxStreak} · {sessionRead.status}</p>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-4 sm:items-end">
            <label className="text-xs font-bold text-slate-600">补回答对题数<input type="number" min={1} max={1000} step={1} value={manualCorrectDelta} onChange={(event) => setManualCorrectDelta(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">补回答错题数<input type="number" min={0} max={1000} step={1} value={manualWrongDelta} onChange={(event) => setManualWrongDelta(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">补分开始前连击<input type="number" min={0} max={10000} step={1} value={manualStartingStreak} onChange={(event) => setManualStartingStreak(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-slate-600">成绩发生时间<input type="datetime-local" value={bonusAchievedAt} onChange={(event) => setBonusAchievedAt(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-slate-600">原因
            <input value={bonusReason} onChange={(event) => setBonusReason(event.target.value)} maxLength={200} placeholder="系统异常未结算" className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" />
          </label>
          <button type="button" onClick={() => submitBackfill('preview', row)} disabled={busy} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-50 disabled:opacity-50">{busy ? '处理中…' : '预览计算'}</button>
          <button type="button" onClick={() => submitBackfill('apply', row)} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? '处理中…' : '确认补录'}</button>
        </div>

        {renderBackfillPreview()}
      </div>
    )
  }

  function renderDeleteConfirm(row: BonusRow) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 p-3 text-xs text-slate-700">
        <p className="font-black text-red-700">确认删除该用户的这条排行榜成绩？</p>
        <div className="mt-2 grid gap-1 rounded-lg border border-slate-200 bg-white p-3 leading-5">
          <p><span className="text-slate-500">用户昵称：</span><b>{row.displayName}</b></p>
          <p><span className="text-slate-500">UID / E院 ID：</span><b>{row.uid}</b></p>
          <p><span className="text-slate-500">模式：</span><b>{MODE_LABELS[row.mode]}</b></p>
          <p><span className="text-slate-500">当前分数：</span><b>{row.score} 分</b></p>
          <p><span className="text-slate-500">成绩时间：</span><b>{new Date(row.achievedAt).toLocaleString()}</b></p>
        </div>
        <p className="mt-2 text-slate-500">删除后仅重新计算该用户受影响的排行榜，不影响其他用户、其他模式，也不会清除游戏历史与答题记录。</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="font-bold text-slate-600">删除原因
            <input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} maxLength={200} placeholder="成绩异常需剔除" className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" />
          </label>
          <button type="button" onClick={() => void submitDelete(row)} disabled={deleteBusy} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{deleteBusy ? '处理中…' : '确认删除该成绩'}</button>
          <button type="button" onClick={() => { setDeletingId(null); setDeleteReason('') }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">取消</button>
        </div>
      </div>
    )
  }

  function submitDelete(row: BonusRow) {
    if (deleteReason.trim().length < 2) {
      setError('请填写删除原因')
      return
    }
    if (!row.sessionId) {
      setError('该成绩缺少对应的游戏记录，无法精确删除')
      return
    }
    setDeleteBusy(true)
    setError('')
    setMessage('')
    void (async () => {
      try {
        const result = await request<DeleteResult>('/api/admin/entertainment/want-listen/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'DELETE_SCORE',
            userId: row.userId,
            mode: bonusMode,
            sessionId: row.sessionId,
            reason: deleteReason.trim(),
          }),
        })
        setMessage(`已删除 ${result.nickname}（UID ${result.uid}）的该条成绩（原 ${result.before.score} 分）；该用户受影响榜单已按剩余合法成绩重新计算。`)
        setDeletingId(null)
        setDeleteReason('')
        await loadBonus()
        if (userResult) void searchUser({ preventDefault: () => undefined } as FormEvent)
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '删除失败')
      } finally {
        setDeleteBusy(false)
      }
    })()
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
                <p className="text-sm text-brand-600">UID {userResult.user.uid} · 有效游戏记录 {userResult.totalEntries} 条 · 异常游戏记录 {userResult.recoverableSessions.length} 条</p>
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
                  <p className="text-brand-600">答对：{score.correctCount} · 最高连击：{score.maxStreak ?? '—'}</p>
                  <p className="text-brand-600">完成时间：{score.completionTimeMs !== null ? `${Math.round(score.completionTimeMs / 1000)} 秒` : '—'}</p>
                </div>
              ))}
            </div>
            {userResult.recoverableSessions.length ? (
              <div className="mt-4">
                <p className="text-sm font-black text-brand-800">异常中断的游戏记录（点击「恢复成绩」直接采用记录内真实成绩）</p>
                <div className="mt-2 space-y-2">
                  {userResult.recoverableSessions.map((session) => (
                    <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white p-3 text-sm">
                      <div>
                        <p className="font-black text-slate-800">{MODE_LABELS[session.mode]} · {session.status} · <span className="text-brand-700">{session.score} 分</span></p>
                        <p className="mt-0.5 text-xs text-slate-500">答对 {session.correctCount} · 完成 {session.totalQuestions} · 最高连击 {session.maxStreak} · 最近活跃 {new Date(session.lastActiveAt).toLocaleString()} · {session.id.slice(0, 8)}…</p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setAdjustingId('user-card-recovery')
                          setBackfillType('SESSION_RECOVERY')
                          setSelectedSessionId(session.id)
                          setBonusMode(session.mode)
                          setBonusReason('')
                          setPreview(null)
                          setBonusBusyKey('')
                          setError('')
                          setMessage('')
                          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
                        }}
                        className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        恢复成绩
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 排行榜补录：异常游戏恢复优先，人工补题次之；不允许直接填写分数 */}
      <section className="mt-8 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Leaderboard Admin</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">排行榜分数管理</h2>
            <p className="mt-1 text-sm text-slate-500">想听排行榜按完整单局成绩排名。补录时请补回答题数据，系统将按照当前模式计分规则自动计算分数，确保分数、答对题数、完成题数和连击一致。</p>
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
            <input value={bonusQuery} onChange={(event) => setBonusQuery(event.target.value)} placeholder="搜索昵称 / 登录账号 / UID" className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>

        {bonusLoading ? <p className="mt-4 text-sm text-slate-500">正在加载榜单…</p> : null}
        {!bonusLoading && !bonusRows.length ? <p className="mt-4 text-sm text-slate-500">当前筛选没有榜单成绩，可在上方按用户查询后补录，或直接读取游戏记录。</p> : null}

        <div className="mt-4 space-y-3">
          {bonusRows.map((row, index) => {
            const busy = bonusBusyKey.startsWith(`bonus:${row.id}`)
            const adjusting = adjustingId === row.id
            return (
              <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <strong className="w-8 text-center text-slate-400">#{index + 1}</strong>
                    <div>
                      <p className="font-black text-slate-900">{row.displayName} <span className="font-normal text-slate-400">UID {row.uid}</span></p>
                      <p className="text-xs text-slate-500">{row.score} 分 · 答对 {row.correctCount} · 最高连击 {row.maxStreak ?? '—'} · 完成 {row.totalQuestions} 题 · {row.sessionStatus || '—'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => adjusting ? setAdjustingId(null) : openBonus(row)} disabled={busy || deletingId === row.id} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{adjusting ? '取消补录' : '补录成绩'}</button>
                    <button type="button" onClick={() => { setDeletingId(deletingId === row.id ? null : row.id); setDeleteReason('') }} disabled={busy || adjusting} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-50">{deletingId === row.id ? '取消删除' : '删除成绩'}</button>
                  </div>
                </div>
                {adjusting ? renderBackfillForm(row) : null}
                {deletingId === row.id ? renderDeleteConfirm(row) : null}
              </article>
            )
          })}
        </div>

        {adjustingId === 'user-card-recovery' ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <p className="text-sm font-black text-slate-800">从异常游戏记录恢复成绩</p>
            {(() => {
              const currentUser = userResult
              if (!currentUser) return null
              const session = currentUser.recoverableSessions.find((item) => item.id === selectedSessionId)
              return (
                <div className="mt-2 space-y-3">
                  {session ? (
                    <div className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
                      <p className="font-black text-slate-800">{MODE_LABELS[session.mode]} · {session.status} · <span className="text-brand-700">{session.score} 分</span></p>
                      <p className="mt-0.5 text-xs text-slate-500">答对 {session.correctCount} · 完成 {session.totalQuestions} · 最高连击 {session.maxStreak} · 当前连击 {session.currentStreak} · 最近活跃 {new Date(session.lastActiveAt).toLocaleString()} · {session.id}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs font-bold text-slate-600">原因
                      <input value={bonusReason} onChange={(event) => setBonusReason(event.target.value)} maxLength={200} placeholder="系统异常未结算" className="mt-1 block w-96 rounded-lg border border-slate-200 px-2 py-2 text-sm" />
                    </label>
                    <button
                      type="button"
                      disabled={busy || bonusBusyKey.startsWith('user-recovery')}
                      onClick={() => {
                        setBonusBusyKey('user-recovery')
                        setError('')
                        setMessage('')
                        void (async () => {
                          try {
                            const result = await request<BackfillResult>('/api/admin/entertainment/want-listen/leaderboard', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'BACKFILL',
                                userId: currentUser.user.id,
                                mode: bonusMode,
                                type: 'SESSION_RECOVERY',
                                sessionId: selectedSessionId,
                                reason: bonusReason.trim(),
                              }),
                            })
                            setMessage(`恢复成功：采用异常游戏记录 ${result.after.score} 分（答对 ${result.after.correctCount} · 完成 ${result.after.totalQuestions} · 最高连击 ${result.after.maxStreak}）${result.leaderboardUpdated === false ? '，已有更高成绩，排行榜保持不变' : ''}`)
                            setAdjustingId(null)
                            setUserResult(null)
                            await loadBonus()
                          } catch (requestError) {
                            setError(requestError instanceof Error ? requestError.message : '恢复失败')
                          } finally {
                            setBonusBusyKey('')
                          }
                        })()
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      {bonusBusyKey === 'user-recovery' ? '处理中…' : '确认恢复该局成绩'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        ) : null}
      </section>
    </div>
  )
}
