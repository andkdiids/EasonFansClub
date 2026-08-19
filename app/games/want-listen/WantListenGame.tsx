'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试。')
  return payload.data
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
  const [finishing, setFinishing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  const [exitOpen, setExitOpen] = useState(false)
  // 答案揭晓守卫：进入新题（question.id 变化）时强制重置为 false，
  // 只有在当前题作答成功后才置为 true。这样上一题的作答/反馈/选项高亮
  // 绝不会残留到下一题（防不胜防模式下杜绝答案闪现）。
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    let active = true
    request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(initialSessionId)}`, { cache: 'no-store' })
      .then((data) => { if (active) setSession(data) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '对局加载失败，请稍后重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [initialSessionId])

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return
    const remaining = new Date(session.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      setSession((current) => current ? { ...current, status: 'EXPIRED', question: null } : current)
      return
    }
    const timer = window.setTimeout(() => {
      request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(initialSessionId)}`, { cache: 'no-store' })
        .then(setSession)
        .catch(() => setSession((current) => current ? { ...current, status: 'EXPIRED', question: null } : current))
    }, remaining + 300)
    return () => window.clearTimeout(timer)
  }, [initialSessionId, session])

  async function answer(optionKey: string) {
    if (!session?.question || session.question.result || answering || session.status !== 'IN_PROGRESS') return
    setAnswering(true)
    setError('')
    try {
      const data = await request<{ state: SessionState }>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: session.question.id, optionKey }),
      })
      setSession(data.state)
      setRevealed(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '答案提交失败，请稍后重试。')
    } finally {
      setAnswering(false)
    }
  }

  async function requestHint() {
    if (!session || session.mode !== 'WANT_LISTEN' || !session.question || session.question.result || hinting || session.question.hintLevel >= 4) return
    setHinting(true)
    setError('')
    try {
      setSession(await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/hint`, { method: 'POST' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提示请求失败，请稍后重试。')
    } finally {
      setHinting(false)
    }
  }

  async function nextQuestion() {
    if (!session || !session.question?.result || nexting || session.status !== 'IN_PROGRESS') return
    setNexting(true)
    setError('')
    try {
      setSession(await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/next`, { method: 'POST' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '下一题加载失败，请稍后重试。')
    } finally {
      setNexting(false)
    }
  }

  // 无尽模式：主动结束并保存本次成绩
  async function finishGame() {
    if (!session || finishing || session.status !== 'IN_PROGRESS') return
    if (!window.confirm('结束本次无尽挑战并保存成绩？\n\n当前进度会以本次成绩进入排行榜与个人统计。')) return
    setFinishing(true)
    setError('')
    try {
      setSession(await request<SessionState>(`/api/entertainment/want-listen/sessions/${encodeURIComponent(session.id)}/finish`, { method: 'POST' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '结束挑战失败，请稍后重试。')
    } finally {
      setFinishing(false)
    }
  }

  // 进入新题时重置揭晓状态：题目 id 变化即清空上一题的作答/反馈/高亮。
  // 恢复已答题目时（resume）会随之把 revealed 设为 true，正常展示既有结果。
  useEffect(() => {
    setRevealed(Boolean(session?.question?.result))
  }, [session?.question?.id, session?.question?.result])

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
      ) : question ? (
        <section className="want-listen-question-panel">
          <div className="want-listen-question-intro"><span>第 {String(question.position).padStart(2, '0')} 题</span><p>{session.mode === 'WANT_LISTEN' ? '线索会逐步出现，答案由服务端判定。' : session.mode === 'CANTONESE_FRAGMENT' ? '选择歌词中消失的那一段。' : '六个歌名里，只有一个不存在。'}</p></div>
          {session.mode === 'WANT_LISTEN' ? <div className="want-listen-hints" aria-label="歌曲线索">{question.hints.map((hint, index) => <div key={index} className={`want-listen-hint hint-${index + 1}`}>{hint.type === 'album-cover' && typeof hint.coverUrl === 'string' ? <><img src={hint.coverUrl} alt="专辑封面线索" /><span>{hintText(hint)}</span></> : <><span className="want-listen-hint-index">0{index + 1}</span><strong>{hintText(hint)}</strong></>}</div>)}</div> : null}
          {session.mode === 'CANTONESE_FRAGMENT' && question.context ? <pre className="want-listen-lyric-context">{question.context}</pre> : null}
          <div className={`want-listen-options mode-${session.mode.toLowerCase()}`}>
            {question.options.map((option) => {
              const selected = revealed && result?.selectedOptionKey === option.key
              const correct = revealed && result?.correctOptionKey === option.key
              const incorrect = selected && !correct
              return <button key={option.key} type="button" onClick={() => void answer(option.key)} disabled={Boolean(result) || answering} className={`${selected ? 'is-selected ' : ''}${correct ? 'is-correct ' : ''}${incorrect ? 'is-incorrect' : ''}`}>{option.label}</button>
            })}
          </div>
          {revealed && result ? <div className={`want-listen-answer-result ${result.correct ? 'is-correct' : 'is-wrong'}`}><b>{result.correct ? '回答正确' : '回答错误'}</b><span>你的答案：{question.options.find((option) => option.key === result.selectedOptionKey)?.label || '—'}</span><span>正确答案：{result.correctAnswer}</span><span>本题得分：{result.awardedScore}</span>{result.completeContext ? <pre>{result.completeContext}</pre> : null}{result.songTitle ? <small>歌曲：{result.songTitle}</small> : null}{session.status === 'IN_PROGRESS' ? <button type="button" onClick={() => void nextQuestion()} disabled={nexting}>{nexting ? '加载中…' : '下一题 →'}</button> : null}</div> : null}
          {!result && session.mode === 'WANT_LISTEN' ? <button type="button" className="want-listen-hint-button" onClick={() => void requestHint()} disabled={hinting || question.hintLevel >= 4}>{question.hintLevel >= 4 ? '已显示全部提示' : hinting ? '正在准备提示…' : '再给点提示'}</button> : null}
        </section>
      ) : <section className="want-listen-ended"><h1>当前题目不可用，请重新开始。</h1><Link href="/games/want-listen">返回想听</Link></section>}

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
