'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CassettePlayer } from '@/components/games/CassettePlayer'
import { GuessAnswerInput } from '@/components/games/GuessAnswerInput'
import { GuessFooter } from '@/components/games/GuessFooter'
import { GuessHeader } from '@/components/games/GuessHeader'
import { GuessResultOverlay } from '@/components/games/GuessResultOverlay'
import { createUUID } from '@/lib/utils/uuid'

type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'ENDLESS'
type AnswerMode = 'CHOICE' | 'INPUT'
type SessionQuestion = {
  answerMode: AnswerMode
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
type AnswerResult = {
  duplicate: boolean
  correct: boolean
  correctSongTitle: string
  awardedScore: number
  session: SessionState
  ranks: { weekRank: number | null; monthRank: number | null } | null
}

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  const legacyName = `E${'声'}猜歌`
  const message = (payload?.error || '请求失败，请稍后重试').split(legacyName).join('听听')
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(message)
  return payload.data
}

export function GuessSongGame({ initialSessionId, exitTarget = '/games/guess-song', hasKnownOrigin = false }: Readonly<{
  initialSessionId: string
  exitTarget?: string
  hasKnownOrigin?: boolean
}>) {
  const router = useRouter()
  const [session, setSession] = useState<SessionState | null>(null)
  const [nextSession, setNextSession] = useState<SessionState | null>(null)
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [answering, setAnswering] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [deadlineSeconds, setDeadlineSeconds] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [exitOpen, setExitOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioGenerationRef = useRef(0)
  const timeoutSubmittedRef = useRef<string | null>(null)
  const submitAnswerRef = useRef<(optionKey: string | null) => void>(() => undefined)
  const startedAtRef = useRef(Date.now())
  const finalRanksRef = useRef<AnswerResult['ranks']>(null)
  const allowNavigationRef = useRef(false)

  const stopAudio = useCallback(() => {
    audioGenerationRef.current += 1
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setPlaying(false)
    setAudioLoading(false)
    setElapsedSeconds(0)
    setDurationSeconds(0)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new Event('easmusic:pause-all'))
    return () => stopAudio()
  }, [stopAudio])

  useEffect(() => {
    let active = true
    api<SessionState>(`/api/entertainment/guess-song/sessions/${initialSessionId}`)
      .then((restored) => {
        if (active) setSession(restored)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '听听加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [initialSessionId])

  useEffect(() => {
    stopAudio()
    setAudioError('')
    setAnswerResult(null)
    setNextSession(null)
    timeoutSubmittedRef.current = null
  }, [session?.question?.publicId, stopAudio])

  useEffect(() => {
    const sessionId = session?.id
    const sessionStatus = session?.status
    if (!sessionId || sessionStatus === 'COMPLETED') return
    const guardId = `guess-song:${sessionId}`
    const installGuard = () => window.history.pushState({ ...window.history.state, gameExitGuard: guardId }, '', window.location.href)
    installGuard()
    const onPopState = () => {
      if (allowNavigationRef.current) return
      installGuard()
      setExitOpen(true)
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [session?.id, session?.status])

  async function requestFreshAudio() {
    const question = session?.question
    if (!session || !question || audioLoading || question.remainingPlayCount <= 0) return
    stopAudio()
    window.dispatchEvent(new Event('easmusic:pause-all'))
    setError('')
    setAudioError('')
    setAudioLoading(true)
    const generation = audioGenerationRef.current
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
        body: JSON.stringify({ questionId: question.publicId, requestKey: createUUID() }),
      })
      if (generation !== audioGenerationRef.current) return
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
      const audio = new Audio()
      audio.preload = 'auto'
      audio.playbackRate = 1
      audioRef.current = audio
      setDurationSeconds(data.durationSeconds)
      audio.addEventListener('timeupdate', () => {
        if (audioRef.current === audio) setElapsedSeconds(Math.min(data.durationSeconds, audio.currentTime))
      })
      audio.addEventListener('playing', () => {
        if (audioRef.current === audio) {
          setPlaying(true)
          setAudioLoading(false)
        }
      })
      audio.addEventListener('pause', () => {
        if (audioRef.current === audio) setPlaying(false)
      })
      audio.addEventListener('ended', () => {
        if (audioRef.current !== audio || generation !== audioGenerationRef.current) return
        setPlaying(false)
        setAudioLoading(false)
        setElapsedSeconds(data.durationSeconds)
        audioRef.current = null
      }, { once: true })
      audio.addEventListener('error', () => {
        if (audioRef.current !== audio || generation !== audioGenerationRef.current) return
        setPlaying(false)
        setAudioLoading(false)
        setAudioError('音频加载失败，请检查网络后重试')
      }, { once: true })
      audio.src = data.signedUrl
      audio.load()
      await audio.play()
    } catch (reason) {
      if (generation !== audioGenerationRef.current) return
      setPlaying(false)
      setAudioLoading(false)
      setAudioError(reason instanceof Error ? reason.message : '音频播放失败')
    }
  }

  async function toggleAudio() {
    const audio = audioRef.current
    if (audio && !audio.ended && audio.currentTime > 0) {
      if (audio.paused) {
        window.dispatchEvent(new Event('easmusic:pause-all'))
        await audio.play().catch(() => setAudioError('音频播放失败'))
      } else {
        audio.pause()
      }
      return
    }
    await requestFreshAudio()
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
      if (result.ranks) finalRanksRef.current = result.ranks
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '答案提交失败')
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

  useEffect(() => {
    const deadline = session?.question?.answerDeadlineAt
    if (!deadline || answerResult) {
      setDeadlineSeconds(null)
      return
    }
    const update = () => setDeadlineSeconds(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [answerResult, session?.question?.answerDeadlineAt])

  const continueGame = useCallback(() => {
    if (!nextSession) return
    stopAudio()
    setAudioError('')
    setSession(nextSession)
    setAnswerResult(null)
    setNextSession(null)
  }, [nextSession, stopAudio])

  useEffect(() => {
    if (!answerResult?.correct || !nextSession) return
    const timer = window.setTimeout(continueGame, 1000)
    return () => window.clearTimeout(timer)
  }, [answerResult, continueGame, nextSession])

  function requestExit() {
    if (session?.status === 'COMPLETED') {
      stopAudio()
      leaveGameRoute()
      return
    }
    setExitOpen(true)
  }

  function leaveGameRoute() {
    allowNavigationRef.current = true
    if (hasKnownOrigin && window.history.length > 2) {
      window.history.go(-2)
    } else {
      router.replace(exitTarget)
    }
  }

  async function confirmExit() {
    if (!session || exiting) return
    setExiting(true)
    stopAudio()
    try {
      if (session.status === 'IN_PROGRESS') {
        await api(`/api/entertainment/guess-song/sessions/${session.id}/abandon`, { method: 'POST' })
      }
      leaveGameRoute()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出失败，请重试')
      setExitOpen(false)
      setExiting(false)
    }
  }

  async function restart() {
    if (!session || exiting) return
    setExiting(true)
    try {
      const data = await api<{ resumed: boolean; session: SessionState }>('/api/entertainment/guess-song/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: session.mode }),
      })
      stopAudio()
      setSession(data.session)
      setAnswerResult(null)
      setNextSession(null)
      finalRanksRef.current = null
      startedAtRef.current = Date.now()
      router.replace(`/games/guess-song/play?session=${encodeURIComponent(data.session.id)}&from=detail`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法重新开始')
    } finally {
      setExiting(false)
    }
  }

  if (loading) return <div className="guess-play-loading">正在装入磁带…</div>
  if (!session) return (
    <main className="guess-play-error">
      <h1>无法进入本局游戏</h1>
      <p>{error || '没有找到有效场次。'}</p>
      <Link href={exitTarget}>返回游戏详情</Link>
    </main>
  )

  if (session.status === 'COMPLETED') {
    const attempts = session.correctCount + session.wrongCount
    const accuracy = attempts ? Math.round(session.correctCount / attempts * 100) : 0
    const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
    return (
      <main className="guess-settlement">
        <span>SESSION COMPLETE</span>
        <h1>{session.mode === 'ENDLESS' ? '无尽挑战结束' : '本局完成'}</h1>
        <strong>{session.score}<small>分</small></strong>
        <div className="guess-settlement-grid">
          <div><span>正确率</span><b>{accuracy}%</b></div>
          <div><span>最高连击</span><b>{session.maxStreak}</b></div>
          <div><span>本次用时</span><b>{elapsed}s</b></div>
          <div><span>经验</span><b>0</b></div>
          <div><span>挂号费</span><b>0</b></div>
          <div><span>周榜</span><b>{finalRanksRef.current?.weekRank ? `#${finalRanksRef.current.weekRank}` : '—'}</b></div>
        </div>
        <p>当前版本猜歌不发放经验或挂号费，成绩仍按既有规则参与排行榜。</p>
        {error ? <p className="guess-play-message is-error">{error}</p> : null}
        <nav>
          <button type="button" onClick={() => void restart()} disabled={exiting}>重新挑战</button>
          <Link href="/entertainment/guess-song/leaderboard">查看排行榜</Link>
          <Link href="/games">返回娱乐天空</Link>
        </nav>
      </main>
    )
  }

  const question = session.question
  if (!question) return <main className="guess-play-error"><p>当前场次没有可用题目。</p><button onClick={requestExit}>退出游戏</button></main>
  const progress = durationSeconds ? elapsedSeconds / durationSeconds * 100 : 0

  return (
  <main className="games-page games-center-background games-full-width immersive-game-layout guess-play-page">
      <button type="button" className="game-exit-button" onClick={requestExit} aria-label="退出游戏">← <span>退出游戏</span></button>
      <div className={`guess-play-shell ${answerResult && !answerResult.correct ? 'is-wrong' : ''}`}>
        <GuessHeader
          mode={`${session.modeLabel}模式`}
          position={question.position}
          total={session.totalQuestions}
          score={session.score}
          streak={session.currentStreak}
          remaining={session.totalQuestions ? Math.max(0, session.totalQuestions - question.position) : null}
          lives={session.mode === 'ENDLESS' ? session.livesRemaining : undefined}
          countdown={deadlineSeconds}
        />
        {error ? <p className="guess-play-message is-error" role="alert">{error}</p> : null}
        {audioError ? <p className="guess-play-message is-error" role="alert">{audioError}</p> : null}
        <CassettePlayer
          playing={playing}
          loading={audioLoading}
          progress={progress}
          elapsedSeconds={elapsedSeconds}
          durationSeconds={durationSeconds || question.playbackDurationSeconds}
          remainingPlayCount={question.remainingPlayCount}
          disabled={audioLoading || Boolean(answerResult) || (question.remainingPlayCount <= 0 && !audioRef.current)}
          onToggle={() => void toggleAudio()}
        />
        <section className="guess-answer-zone">
<GuessAnswerInput
  key={question.publicId}
mode="CHOICE"
  options={question.options}
  disabled={answering || Boolean(answerResult)}
  played={question.playCount > 0}
  wrongPulse={answerResult && !answerResult.correct ? 1 : 0}
  onSubmit={(key) => void submitAnswer(key)}
/>
          <GuessFooter played={question.playCount > 0} playCount={question.playCount} maxPlayCount={question.maxPlayCount} />
        </section>
        {answerResult ? (
          <GuessResultOverlay
            correct={answerResult.correct}
            title={answerResult.correctSongTitle}
            score={answerResult.awardedScore}
            final={nextSession?.status === 'COMPLETED'}
            onContinue={continueGame}
          />
        ) : null}
      </div>
      {exitOpen ? (
        <div className="game-exit-dialog-backdrop" role="presentation">
          <section className="game-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="game-exit-title">
            <span>LEAVE SESSION</span>
            <h2 id="game-exit-title">退出当前游戏？</h2>
            <p>本局未完成的进度不会计入成绩。</p>
            <div>
              <button type="button" onClick={() => setExitOpen(false)} disabled={exiting}>继续游戏</button>
              <button type="button" onClick={() => void confirmExit()} disabled={exiting}>{exiting ? '正在退出…' : '确认退出'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
