'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'ENDLESS'
type SessionQuestion = {
  publicId: string
  position: number
  playbackDurationSeconds: number
  maxPlayCount: number
  playCount: number
  remainingPlayCount: number
  options: Array<{ key: string; label: string }>
  answerDeadlineAt: string | null
}
type SessionState = {
  id: string
  mode: Mode
  modeLabel: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'EXPIRED'
  score: number
  correctCount: number
  wrongCount: number
  currentStreak: number
  maxStreak: number
  livesRemaining: number
  totalPlayCount: number
  currentPosition: number
  totalQuestions: number | null
  expiresAt: string
  completedAt: string | null
  question: SessionQuestion | null
}
type LobbySummary = {
  weeklyBest: number | null
  monthlyBest: number | null
  recentSession: {
    id: string
    mode: Mode
    score: number
    correctCount: number
    wrongCount: number
    maxStreak: number
    totalPlayCount: number
    completedAt: string
  } | null
  activeSessions: Array<{ id: string; mode: Mode; currentPosition: number; expiresAt: string }>
}
type AnswerResult = {
  duplicate: boolean
  correct: boolean
  correctSongTitle: string
  awardedScore: number
  session: SessionState
  ranks: { weekRank: number | null; monthRank: number | null } | null
}

const modes: Array<{ mode: Mode; label: string; detail: string; rule: string }> = [
  { mode: 'EASY', label: '简单', detail: '7秒音频 · 最多播放2次', rule: '每局10题' },
  { mode: 'ADVANCED', label: '进阶', detail: '4秒音频 · 最多播放3次', rule: '每局10题' },
  { mode: 'HARD', label: '困难', detail: '2秒音频 · 最多播放5次', rule: '每局10题' },
  { mode: 'ENDLESS', label: '无尽', detail: '随机2至7秒 · 最多播放5次', rule: '3次失误机会' },
]

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试')
  return payload.data
}

export function GuessSongGame({ initialSessionId }: Readonly<{ initialSessionId: string | null }>) {
  const [summary, setSummary] = useState<LobbySummary | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [nextSession, setNextSession] = useState<SessionState | null>(null)
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [startingMode, setStartingMode] = useState<Mode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [playedOnce, setPlayedOnce] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timeoutSubmittedRef = useRef<string | null>(null)
  const submitAnswerRef = useRef<(optionKey: string | null) => void>(() => undefined)

  function stopAudio() {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.src = ''
    audio.load()
    audioRef.current = null
    setPlaying(false)
    setRemainingSeconds(0)
  }

  useEffect(() => () => stopAudio(), [])

  useEffect(() => {
    stopAudio()
    setPlayedOnce(false)
    setAnswerResult(null)
    setNextSession(null)
    timeoutSubmittedRef.current = null
  }, [session?.question?.publicId])

  useEffect(() => {
    Promise.all([
      api<LobbySummary>('/api/entertainment/guess-song/sessions'),
      initialSessionId
        ? api<SessionState>(`/api/entertainment/guess-song/sessions/${initialSessionId}`)
        : Promise.resolve(null),
    ])
      .then(([lobby, restored]) => {
        setSummary(lobby)
        if (restored) setSession(restored)
      })
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'E声猜歌加载失败'))
      .finally(() => setLoading(false))
  }, [initialSessionId])

  async function start(mode: Mode) {
    if (startingMode) return
    setStartingMode(mode)
    setError('')
    try {
      const data = await api<{ resumed: boolean; session: SessionState }>('/api/entertainment/guess-song/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      setSession(data.session)
      window.history.replaceState(null, '', `/entertainment/guess-song?session=${encodeURIComponent(data.session.id)}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '场次创建失败')
    } finally {
      setStartingMode(null)
    }
  }

  async function playAudio() {
    const question = session?.question
    if (!session || !question || playing || question.remainingPlayCount <= 0) return
    stopAudio()
    setError('')
    setPlaying(true)
    try {
      const data = await api<{
        signedUrl: string
        durationSeconds: number
        playCount: number
        remainingPlayCount: number
        answerDeadlineAt: string | null
      }>(`/api/entertainment/guess-song/sessions/${session.id}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.publicId, requestKey: crypto.randomUUID() }),
      })
      setSession((current) => current?.question ? {
        ...current,
        totalPlayCount: current.totalPlayCount + 1,
        question: {
          ...current.question,
          playCount: data.playCount,
          remainingPlayCount: data.remainingPlayCount,
          answerDeadlineAt: data.answerDeadlineAt,
        },
      } : current)
      const audio = new Audio(data.signedUrl)
      audio.preload = 'auto'
      audio.playbackRate = 1
      audioRef.current = audio
      setRemainingSeconds(data.durationSeconds)
      audio.addEventListener('timeupdate', () => {
        setRemainingSeconds(Math.max(0, Math.ceil(data.durationSeconds - audio.currentTime)))
      })
      audio.addEventListener('ended', () => {
        setPlaying(false)
        setPlayedOnce(true)
        setRemainingSeconds(0)
        audioRef.current = null
      }, { once: true })
      audio.addEventListener('error', () => {
        setPlaying(false)
        setError('音频加载失败，请检查网络后重试')
        audioRef.current = null
      }, { once: true })
      await audio.play()
    } catch (requestError) {
      setPlaying(false)
      setError(requestError instanceof Error ? requestError.message : '音频播放失败')
    }
  }

  async function submitAnswer(optionKey: string | null) {
    const question = session?.question
    if (!session || !question || answering || answerResult) return
    stopAudio()
    setAnswering(true)
    setError('')
    try {
      const result = await api<AnswerResult>(`/api/entertainment/guess-song/sessions/${session.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.publicId, optionKey }),
      })
      setAnswerResult(result)
      setNextSession(result.session)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '答案提交失败')
    } finally {
      setAnswering(false)
    }
  }
  submitAnswerRef.current = (optionKey) => { void submitAnswer(optionKey) }

  useEffect(() => {
    const deadline = session?.question?.answerDeadlineAt
    const publicId = session?.question?.publicId
    if (!deadline || !publicId || answerResult) return
    const remaining = new Date(deadline).getTime() - Date.now()
    const timer = window.setTimeout(() => {
      if (timeoutSubmittedRef.current === publicId) return
      timeoutSubmittedRef.current = publicId
      submitAnswerRef.current(null)
    }, Math.max(0, remaining + 100))
    return () => window.clearTimeout(timer)
  }, [answerResult, session?.question?.answerDeadlineAt, session?.question?.publicId])

  function continueGame() {
    if (!nextSession) return
    setSession(nextSession)
    setAnswerResult(null)
    setNextSession(null)
  }

  async function abandon() {
    if (!session || !window.confirm('确定退出本场游戏吗？未完成场次不会进入排行榜。')) return
    stopAudio()
    try {
      await api(`/api/entertainment/guess-song/sessions/${session.id}/abandon`, { method: 'POST' })
      setSession(null)
      window.history.replaceState(null, '', '/entertainment/guess-song')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '退出失败')
    }
  }

  if (loading) return <div className="guess-song-loading">正在准备E声猜歌…</div>

  if (!session) {
    return (
      <>
        <header className="guess-song-heading">
          <p>Listen &amp; Guess</p>
          <h1>E声猜歌</h1>
          <span>听一小段，你能认出是哪首歌吗？</span>
        </header>
        {error ? <p className="guess-song-error" role="alert">{error}</p> : null}
        <section className="guess-song-summary">
          <div><span>我的本周最高分</span><strong>{summary?.weeklyBest ?? '暂无'}</strong></div>
          <div><span>我的本月最高分</span><strong>{summary?.monthlyBest ?? '暂无'}</strong></div>
          <Link href="/entertainment/guess-song/leaderboard?period=WEEK">周排行榜</Link>
          <Link href="/entertainment/guess-song/leaderboard?period=MONTH">月排行榜</Link>
        </section>
        <section className="guess-song-mode-grid">
          {modes.map((item) => {
            const active = summary?.activeSessions.find((sessionItem) => sessionItem.mode === item.mode)
            return (
              <button key={item.mode} type="button" onClick={() => void start(item.mode)} disabled={Boolean(startingMode)}>
                <span>{item.mode}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
                <b>{active ? `继续第 ${active.currentPosition} 题` : item.rule}</b>
              </button>
            )
          })}
        </section>
        <section className="guess-song-recent">
          <h2>最近一次游戏</h2>
          {summary?.recentSession ? (
            <div>
              <strong>{modes.find((item) => item.mode === summary.recentSession?.mode)?.label} · {summary.recentSession.score} 分</strong>
              <span>答对 {summary.recentSession.correctCount} · 最高连击 {summary.recentSession.maxStreak} · 播放 {summary.recentSession.totalPlayCount} 次</span>
            </div>
          ) : <p>完成第一场游戏后，结果会显示在这里。</p>}
        </section>
      </>
    )
  }

  if (session.status === 'COMPLETED') {
    return (
      <section className="guess-song-settlement">
        <p>Game complete</p>
        <h1>{session.mode === 'ENDLESS' ? '无尽挑战结束' : '本局完成'}</h1>
        <strong>{session.score} 分</strong>
        <div>
          <span>答对<strong>{session.correctCount}</strong></span>
          <span>答错<strong>{session.wrongCount}</strong></span>
          <span>最高连击<strong>{session.maxStreak}</strong></span>
          <span>{session.mode === 'ENDLESS' ? '坚持关卡' : '总播放次数'}<strong>{session.mode === 'ENDLESS' ? session.correctCount + session.wrongCount : session.totalPlayCount}</strong></span>
          {session.mode === 'ENDLESS' ? <span>总播放次数<strong>{session.totalPlayCount}</strong></span> : null}
        </div>
        {answerResult?.ranks ? <p>本周排名：{answerResult.ranks.weekRank ?? '未上榜'} · 本月排名：{answerResult.ranks.monthRank ?? '未上榜'}</p> : null}
        <nav>
          <button type="button" onClick={() => { setSession(null); void start(session.mode) }}>再来一局</button>
          <Link href="/entertainment/guess-song/leaderboard">查看排行榜</Link>
          <Link href="/entertainment">返回娱乐中心</Link>
        </nav>
      </section>
    )
  }

  const question = session.question
  if (!question) return <p className="guess-song-error">当前场次没有可用题目，请退出后重新开始。</p>

  return (
    <section className="guess-song-game">
      <header>
        <div><span>{session.modeLabel}模式</span><strong>{session.totalQuestions ? `${question.position}/${session.totalQuestions}` : `第 ${question.position} 关`}</strong></div>
        <div><span>当前得分</span><strong>{session.score}</strong></div>
        <div><span>当前连击</span><strong>{session.currentStreak}</strong></div>
        {session.mode === 'ENDLESS' ? <div><span>剩余机会</span><strong>{session.livesRemaining}</strong></div> : null}
        <button type="button" onClick={() => void abandon()}>退出本局</button>
      </header>
      {error ? <p className="guess-song-error" role="alert">{error}</p> : null}
      <div className={`guess-song-wave ${playing ? 'is-playing' : ''}`} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
      </div>
      <button className="guess-song-play" type="button" onClick={() => void playAudio()} disabled={playing || question.remainingPlayCount <= 0 || Boolean(answerResult)}>
        {playing
          ? `正在播放 00:${String(remainingSeconds).padStart(2, '0')}`
          : question.remainingPlayCount <= 0
            ? '播放次数已用完'
            : playedOnce || question.playCount > 0
              ? `再听一次 · 剩余${question.remainingPlayCount}次`
              : `播放音频 · 剩余${question.remainingPlayCount}次`}
      </button>
      <p className="guess-song-play-count">当前题已播放 {question.playCount} 次，最多 {question.maxPlayCount} 次</p>
      <div className="guess-song-options">
        {question.options.map((option) => (
          <button key={option.key} type="button" onClick={() => void submitAnswer(option.key)} disabled={answering || question.playCount < 1 || Boolean(answerResult)}>
            {option.label}
          </button>
        ))}
      </div>
      {question.playCount < 1 ? <p className="guess-song-hint">请先手动播放音频，再选择答案。</p> : null}
      {answerResult ? (
        <div className={`guess-song-answer-result ${answerResult.correct ? 'is-correct' : 'is-wrong'}`}>
          <strong>{answerResult.correct ? `回答正确 · +${answerResult.awardedScore} 分` : '回答错误'}</strong>
          <span>正确歌曲：《{answerResult.correctSongTitle}》</span>
          <button type="button" onClick={continueGame}>{nextSession?.status === 'COMPLETED' ? '查看结算' : '下一题'}</button>
        </div>
      ) : null}
    </section>
  )
}
