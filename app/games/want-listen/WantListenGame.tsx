'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isSessionDefinitivelyInvalid } from '@/lib/client-auth'
import { canGoToNextQuestion, getWantListenQuestionPhase } from '@/lib/want-listen-client-state'
import { WANT_LISTEN_MODE_LABELS, type WantListenMode } from '@/lib/want-listen-config'

type QuestionResult = {
  selectedOptionKey: string | null
  correctOptionKey: string
  correct: boolean
  awardedScore: number
  correctAnswer: string
  songTitle: string | null
  completeContext: string | null
}

type SessionQuestion = {
  id: string
  position: number
  hintLevel: number
  options: Array<{ key: string; label: string }>
  hints: Array<Record<string, unknown>>
  context: string | null
  result: QuestionResult | null
}

type SessionState = {
  id: string
  mode: WantListenMode
  modeLabel: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'EXPIRED'
  currentQuestion: number
  totalQuestions: number | null
  totalAnswered: number
  currentStreak: number
  maxStreak: number
  wrongCount: number
  livesRemaining: number
  maxWrongCount: number
  score: number
  correctCount: number
  startedAt: string
  completedAt: string | null
  completionTimeMs: number | null
  expiresAt: string
  question: SessionQuestion | null
}

type ApiRequestError = Error & { code?: string; status?: number }

// 指数退避：500ms → 1s → 2s（最多 3 次自动重试），用于网络波动与 5xx
const RETRY_DELAYS = [500, 1000, 2000]

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function toApiError(error: unknown, message: string, code: string, status: number): ApiRequestError {
  return Object.assign(new Error(error instanceof Error ? error.message : message), { code, status })
}

async function request<T>(url: string, init?: RequestInit, retries = 3): Promise<T> {
  let lastError: ApiRequestError | null = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (reason) {
      // 网络层失败（fetch failed / AbortError 等）：自动重试，不当作「需要登录」
      lastError = toApiError(reason, '暂时无法连接服务器，正在恢复…', 'NETWORK_ERROR', 0)
      if (attempt < retries) { await delay(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]); continue }
      throw lastError
    }
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string; code?: string } | null
    const code = payload?.code
    // 业务接口的 401/鉴权码仍需由权威 Session 接口确认，避免普通接口异常
    // 把当前对局误判为登录失效。
    if (response.status === 401 || code === 'AUTH_REQUIRED' || code === 'AUTH_SESSION_EXPIRED') {
      const sessionInvalid = await isSessionDefinitivelyInvalid()
      if (sessionInvalid) {
        throw toApiError(new Error(payload?.error || '登录状态已失效，请重新登录。'), '登录状态已失效，请重新登录。', 'AUTH_REQUIRED', response.status)
      }
      throw toApiError(new Error(payload?.error || '请求暂时无法完成，请稍后重试。'), '请求暂时无法完成，请稍后重试。', 'AUTH_UNCERTAIN', response.status)
    }
    if (!response.ok || !payload?.ok || payload.data === undefined) {
      // 5xx / 429 属于服务器临时波动：自动重试后仍失败才抛出
      if ((response.status >= 500 || response.status === 429) && attempt < retries) {
        lastError = toApiError(new Error(payload?.error || '服务暂时不可用'), payload?.error || '服务暂时不可用，正在恢复…', code || 'SERVER_ERROR', response.status)
        await delay(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)])
        continue
      }
      throw toApiError(new Error(payload?.error || '请求失败，请稍后重试。'), payload?.error || '请求失败，请稍后重试。', code || 'REQUEST_FAILED', response.status)
    }
    return payload.data
  }
  throw lastError ?? new Error('请求失败，请稍后重试。')
}

function hintText(hint: Record<string, unknown>) {
  if (typeof hint.text === 'string') return hint.text
  if (hint.type === 'album-cover' && typeof hint.albumName === 'string') return `专辑：《${hint.albumName}》`
  if (hint.type === 'credit' && typeof hint.label === 'string' && typeof hint.value === 'string') return `${hint.label}：${hint.value}`
  if (hint.type === 'credits' && Array.isArray(hint.credits)) {
    return hint.credits.map((item) => {
      if (!item || typeof item !== 'object') return ''
      const value = item as { label?: unknown; value?: unknown }
      return typeof value.label === 'string' && typeof value.value === 'string' ? `${value.label}：${value.value}` : ''
    }).filter(Boolean).join(' · ')
  }
  return ''
}

export function WantListenGame({ initialSessionId }: Readonly<{ initialSessionId: string }>) {
  const router = useRouter()
  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [answering, setAnswering] = useState(false)
  const [hinting, setHinting] = useState(false)
  const [nexting, setNexting] = useState(false)
  const nextingRef = useRef(false)
  const [finishing, setFinishing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  const [authError, setAuthError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  // 区分真实鉴权错误与普通接口/网络错误：
  //  - 权威 Session 确认失效 → 提示重新认证，但不清空游戏状态
  //  - 普通接口 401 且权威 Session 仍有效 → 按请求失败处理
  //  - 500/网络错误 → 「网络波动，正在恢复…」，按请求幂等性恢复，不结束当前局
  function handleRequestError(reason: unknown, fallback: string) {
    const apiError = reason as ApiRequestError
    if (apiError?.code === 'AUTH_REQUIRED') {
      setAuthError(apiError.message || '登录状态已失效，请重新登录。')
      return
    }
    if (apiError?.code === 'NETWORK_ERROR' || (apiError?.status && apiError.status >= 500)) {
      setError(apiError.message || '网络波动，正在恢复…')
      return
    }
    setError(reason instanceof Error ? reason.message : fallback)
  }

  async function recoverSession() {
    if (recovering) return
    setRecovering(true)
    setRecoveryFailed(false)
    try {
      const data = await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(initialSessionId)}`, { cache: 'no-store' }, 5)
      setSession(data)
      setError('')
      setAuthError('')
    } catch (reason) {
      handleRequestError(reason, '对局恢复失败，请稍后重试。')
      setRecoveryFailed(true)
    } finally {
      setRecovering(false)
    }
  }

  useEffect(() => {
    let active = true
    request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(initialSessionId)}`, { cache: 'no-store' })
      .then((data) => { if (active) setSession(data) })
      .catch((reason: unknown) => { if (active) handleRequestError(reason, '对局加载失败，请稍后重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [initialSessionId])

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return
    const remaining = new Date(session.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      // 到期后先向服务端确认：滑动续期可能已刷新，不能本地直接判过期
      void recoverSession()
      return
    }
    const timer = window.setTimeout(() => {
      void recoverSession()
    }, remaining + 300)
    return () => window.clearTimeout(timer)
  }, [initialSessionId, session])

  // IN_PROGRESS 但当前题缺失（question 为 null）：自动向服务端恢复重建当前题，
  // 不强制重新开始。恢复失败时显示可手动重试的恢复页。
  useEffect(() => {
    if (!session || loading || session.status !== 'IN_PROGRESS' || session.question || recovering || recoveryFailed) return
    void recoverSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading, recovering, recoveryFailed])

  async function answer(optionKey: string) {
    if (!session?.question || session.question.result || answering || session.status !== 'IN_PROGRESS') return
    setAnswering(true)
    setError('')
    setAuthError('')
    try {
      const data = await request<{ state: SessionState }>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: session.question.id, optionKey }),
      })
      setSession(data.state)
    } catch (reason) {
      handleRequestError(reason, '答案提交失败，请稍后重试。')
    } finally {
      setAnswering(false)
    }
  }

  async function requestHint() {
    if (!session || session.mode !== 'WANT_LISTEN' || !session.question || session.question.result || hinting || session.question.hintLevel >= 5) return
    setHinting(true)
    setError('')
    setAuthError('')
    try {
      setSession(await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/hint`, { method: 'POST' }))
    } catch (reason) {
      handleRequestError(reason, '提示请求失败，请稍后重试。')
    } finally {
      setHinting(false)
    }
  }

  async function nextQuestion() {
    const questionId = session?.question?.id
    if (!session || !questionId || !canGoToNextQuestion(session.status, session.question) || nextingRef.current) return
    nextingRef.current = true
    setNexting(true)
    setError('')
    setAuthError('')
    try {
      setSession(await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId }),
      }, 0))
    } catch (reason) {
      // /next 会推进服务端状态。响应丢失或服务端在提交后报错时，
      // 不能再次重放同一个 POST；改用幂等 GET 对齐服务端当前题目。
      const apiError = reason as ApiRequestError
      const shouldReconcile = apiError?.code === 'NETWORK_ERROR'
        || apiError?.status === 409
        || Boolean(apiError?.status && apiError.status >= 500)
      if (shouldReconcile) {
        try {
          const recovered = await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}`, { cache: 'no-store' }, 5)
          setSession(recovered)
          setError('')
          setAuthError('')
          return
        } catch {
          // 继续显示原始错误，并保留当前题结果，用户可以稍后重试。
        }
      }
      handleRequestError(reason, '下一题加载失败，请稍后重试。')
    } finally {
      nextingRef.current = false
      setNexting(false)
    }
  }

  // 无尽模式：主动结束并保存本次成绩
  async function finishGame() {
    if (!session || finishing || session.status !== 'IN_PROGRESS') return
    if (!window.confirm('结束本次无尽挑战并保存成绩？\n\n当前进度会以本次成绩进入排行榜与个人统计。')) return
    setFinishing(true)
    setError('')
    setAuthError('')
    try {
      setSession(await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/finish`, { method: 'POST' }))
    } catch (reason) {
      handleRequestError(reason, '结束挑战失败，请稍后重试。')
    } finally {
      setFinishing(false)
    }
  }

  async function abandon() {
    if (!session) return router.push('/games/want-listen')
    try {
      await request(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/abandon`, { method: 'POST' })
    } catch {
      // A completed or expired session can still safely return to the lobby.
    }
    router.push('/games/want-listen')
  }

  if (loading) return <main className="want-listen-game"><p className="want-listen-loading">正在恢复本局游戏…</p></main>
  if (!session) return <main className="want-listen-game"><p className="want-listen-error" role="alert">{error || '本局游戏不存在。'}</p><Link className="want-listen-primary-link" href="/games/want-listen">返回想听</Link></main>

  const question = session.question
  const result = question?.result
  const isSettlement = session.status === 'COMPLETED'
  const isExpired = session.status === 'EXPIRED'
  // 本题是否完成只由服务端返回的 question.result 决定；结果展示、选项锁定、下一题资格共用这一来源。
  const questionPhase = getWantListenQuestionPhase({ status: session.status, question, answering, nexting })
  const canGoNext = canGoToNextQuestion(session.status, question)

  return (
    <main className={`want-listen-game${session.status === 'IN_PROGRESS' ? ' has-top-controls' : ''}`}>
      {session.status === 'IN_PROGRESS' ? (
        <>
          <button type="button" className="want-listen-game-exit-button" onClick={() => setExitOpen(true)} aria-label="退出游戏">← <span>退出游戏</span></button>
          <button type="button" className="want-listen-game-pause-button" onClick={() => setPaused(true)} disabled={answering || nexting} aria-label="暂停游戏">{paused ? '已暂停' : '暂停游戏'}</button>
        </>
      ) : null}
      <header className="want-listen-game-header">
        <div><span>{session.modeLabel}</span><strong>{session.totalQuestions === null ? `无尽 · 第 ${String(session.currentQuestion).padStart(2, '0')} 题` : `${String(session.currentQuestion).padStart(2, '0')} / ${session.totalQuestions}`}</strong></div>
        <div><span>答对</span><strong>{session.correctCount}</strong></div>
        <div><span>连击</span><strong>{session.currentStreak}</strong></div>
        <div><span>分数</span><strong>{session.score}</strong></div>
      </header>

      {error ? <p className="want-listen-error" role="alert">{error}</p> : null}
      {authError ? <p className="want-listen-error" role="alert">{authError}<Link href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/games/want-listen')}`}>重新登录后继续本局 →</Link></p> : null}
      {isExpired ? (
        <section className="want-listen-ended"><h1>本局游戏已结束，请重新开始。</h1><Link href="/games/want-listen">返回想听</Link></section>
      ) : isSettlement ? (
        <section className="want-listen-settlement">
          <h1>{WANT_LISTEN_MODE_LABELS[session.mode]}完成</h1>
          <strong>{session.score}<small> 分</small></strong>
          <div><span>答对<strong>{session.correctCount}</strong></span><span>最高连击<strong>{session.maxStreak}</strong></span><span>完成用时<strong>{Math.max(1, Math.round((session.completionTimeMs || 0) / 1000))} 秒</strong></span></div>
          {result ? <div className={`want-listen-answer-result ${result.correct ? 'is-correct' : 'is-wrong'}`}><b>{result.correct ? '回答正确' : '回答错误'}</b><span>正确答案：{result.correctAnswer}</span>{result.completeContext ? <pre>{result.completeContext}</pre> : null}</div> : null}
          <nav><Link href="/games/want-listen">返回想听</Link><Link href="/games/want-listen/leaderboard">查看排行榜</Link></nav>
        </section>
      ) : !question ? (
        // 当前题缺失：先自动向服务端恢复（重建当前题），不强制重新开始
        <section className="want-listen-ended">
          {recovering ? <h1>正在恢复当前题目…</h1> : recoveryFailed ? (
            <>
              <h1>当前题目暂不可用</h1>
              <p>你的对局进度已保存，可尝试重新恢复。</p>
              <nav><button type="button" className="want-listen-primary-link" onClick={() => void recoverSession()}>重新恢复本局</button><Link href="/games/want-listen">返回想听</Link></nav>
            </>
          ) : <h1>正在恢复当前题目…</h1>}
        </section>
      ) : question ? (
        <section className="want-listen-question-panel" data-question-phase={questionPhase}>
          <div className="want-listen-question-intro"><span>第 {String(question.position).padStart(2, '0')} 题</span><p>{session.mode === 'WANT_LISTEN' ? '线索会逐步出现，答案由服务端判定。' : session.mode === 'CANTONESE_FRAGMENT' ? '选择歌词中消失的那一段。' : '六个歌名里，只有一个不存在。'}</p></div>
          {session.mode === 'WANT_LISTEN' ? <div className="want-listen-hints" aria-label="歌曲线索">{question.hints.map((hint, index) => <div key={index} className={`want-listen-hint hint-${index + 1}`}>{hint.type === 'album-cover' && typeof hint.coverUrl === 'string' ? <><img src={hint.coverUrl} alt="专辑封面线索" /><span>{hintText(hint)}</span></> : <><span className="want-listen-hint-index">0{index + 1}</span><strong>{hintText(hint)}</strong></>}</div>)}</div> : null}
          {session.mode === 'CANTONESE_FRAGMENT' && question.context ? <pre className="want-listen-lyric-context">{question.context}</pre> : null}
          <div className={`want-listen-options mode-${session.mode.toLowerCase()}`}>
            {question.options.map((option) => {
              const selected = result?.selectedOptionKey === option.key
              const correct = result?.correctOptionKey === option.key
              const incorrect = selected && !correct
              return <button key={option.key} type="button" onClick={() => void answer(option.key)} disabled={Boolean(result) || answering} className={`${selected ? 'is-selected ' : ''}${correct ? 'is-correct ' : ''}${incorrect ? 'is-incorrect' : ''}`}>{option.label}</button>
            })}
          </div>
          {result ? <div className={`want-listen-answer-result ${result.correct ? 'is-correct' : 'is-wrong'}`}><b>{result.correct ? '回答正确' : '回答错误'}</b><span>你的答案：{question.options.find((option) => option.key === result.selectedOptionKey)?.label || '—'}</span><span>正确答案：{result.correctAnswer}</span><span>本题得分：{result.awardedScore}</span>{result.completeContext ? <pre>{result.completeContext}</pre> : null}{result.songTitle ? <small>歌曲：{result.songTitle}</small> : null}{canGoNext ? <button type="button" onClick={() => void nextQuestion()} disabled={nexting}>{nexting ? '加载中…' : '下一题 →'}</button> : null}</div> : null}
          {!result && session.mode === 'WANT_LISTEN' ? (
            <>
              <p className="want-listen-hint-score-note" style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 8px' }}>
                {(() => {
                  const hintsUsed = question.hintLevel - 1
                  if (hintsUsed <= 0) return '未提示：本题答对可得 100 分（连击节点额外 +270）'
                  if (hintsUsed >= 4) return '已使用 4 个提示：本题答对不再获得基础分'
                  const base = Math.max(0, 100 - hintsUsed * 25)
                  return `已使用 ${hintsUsed} 个提示：本题答对可得 ${base} 分（使用提示不参与连击奖励）`
                })()}
              </p>
              <button type="button" className="want-listen-hint-button" onClick={() => void requestHint()} disabled={hinting || question.hintLevel >= 5}>{question.hintLevel >= 5 ? '已显示全部提示' : hinting ? '正在准备提示…' : '再给点提示'}</button>
            </>
          ) : null}
        </section>
      ) : null}

      {paused ? (
        <div className="want-listen-pause-backdrop" role="presentation">
          <section className="want-listen-pause-card" role="dialog" aria-modal="true" aria-labelledby="want-listen-pause-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="want-listen-pause-title">游戏已暂停</h2>
            <dl>
              <div><dt>分数</dt><dd>{session.score}</dd></div>
              <div><dt>答对</dt><dd>{session.correctCount}</dd></div>
              <div><dt>最高连击</dt><dd>{session.maxStreak}</dd></div>
            </dl>
            <div className="want-listen-pause-actions">
              <button type="button" onClick={() => setPaused(false)}>继续挑战</button>
              <button type="button" onClick={() => { setPaused(false); void finishGame() }} disabled={finishing}>{finishing ? '结算中…' : '结束挑战'}</button>
              <button type="button" className="is-danger" onClick={() => { setPaused(false); void abandon() }}>退出游戏</button>
            </div>
          </section>
        </div>
      ) : null}

      {exitOpen ? <div className="want-listen-modal-backdrop" role="presentation" onClick={() => setExitOpen(false)}><section className="want-listen-modal" role="dialog" aria-modal="true" aria-labelledby="want-listen-exit-title" onClick={(event) => event.stopPropagation()}><h2 id="want-listen-exit-title">确定退出本次挑战吗？</h2><p>退出后本次挑战进度不会保存。</p><div><button type="button" onClick={() => setExitOpen(false)}>继续游戏</button><button type="button" className="is-danger" onClick={() => void abandon()}>退出游戏</button></div></section></div> : null}
    </main>
  )
}
