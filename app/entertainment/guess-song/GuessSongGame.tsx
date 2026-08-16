'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CassettePlayer } from '@/components/games/CassettePlayer'
import { GuessAnswerInput, type GuessAnswerSubmission, type GuessSongCandidate } from '@/components/games/GuessAnswerInput'
import { GuessFooter } from '@/components/games/GuessFooter'
import { GuessHeader } from '@/components/games/GuessHeader'
import { GuessResultOverlay } from '@/components/games/GuessResultOverlay'
import { createUUID } from '@/lib/utils/uuid'

type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'EXPERT'
type AnswerMode = 'CHOICE' | 'INPUT'
type SessionQuestion = {
  answerMode: AnswerMode
  publicId: string
  questionAttemptToken: string | null
  position: number
  playbackDurationSeconds: number
  maxPlayCount: number
  playCount: number
  remainingPlayCount: number
  options: Array<{ key: string; label: string }>
  answerDeadlineAt: string | null
  answerAvailableAt: string | null
}
type SessionState = {
  id: string
  mode: Mode
  modeLabel: string
  status: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'EXPIRED' | 'CHEAT_DETECTED'
  riskScore: number
  isValid: boolean
  clientSessionToken: string
  score: number
  correctCount: number
  wrongCount: number
  currentStreak: number
  maxStreak: number
  livesRemaining: number
  maxWrongCount: number | null
  totalPlayCount: number
  currentPosition: number
  totalQuestions: number | null
  expiresAt: string
  pausedAt: string | null
  completedAt: string | null
  question: SessionQuestion | null
}
type AnswerResult = {
  duplicate: boolean
  correct: boolean
  answerStatus: 'CORRECT' | 'WRONG' | 'UNKNOWN'
  skipped: boolean
  correctSongTitle: string
  correctSongArtist: string | null
  correctSongAlbumTitle: string | null
  correctSongReleaseYear: number | null
  correctSongDescription: string | null
  awardedScore: number
  session: SessionState
  ranks: { weekRank: number | null; monthRank: number | null } | null
  cheatDetected?: boolean
  exitAfterSeconds?: number
}

type PendingPlayRequest = {
  publicId: string
  promise: Promise<boolean>
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
  const [skipPending, setSkipPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [answering, setAnswering] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [deadlineSeconds, setDeadlineSeconds] = useState<number | null>(null)
  const [startedQuestionId, setStartedQuestionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [exitOpen, setExitOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [forceEnded, setForceEnded] = useState(false)
  const [cheatDetected, setCheatDetected] = useState(false)
  const [cheatCountdown, setCheatCountdown] = useState(10)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioGenerationRef = useRef(0)
  const playRequestRef = useRef<PendingPlayRequest | null>(null)
  const timeoutSubmittedRef = useRef<string | null>(null)
  const submittedQuestionRef = useRef<string | null>(null)
  const submitAnswerRef = useRef<(answer: GuessAnswerSubmission) => void>(() => undefined)
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
    if (session?.status === 'CHEAT_DETECTED') setCheatDetected(true)
  }, [session?.status])

  useEffect(() => {
    if (!cheatDetected) return
    stopAudio()
    setCheatCountdown(10)
    let remaining = 10
    const timer = window.setInterval(() => {
      remaining -= 1
      setCheatCountdown(Math.max(0, remaining))
      if (remaining <= 0) {
        window.clearInterval(timer)
        allowNavigationRef.current = true
        router.replace('/games')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cheatDetected, router, stopAudio])

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return
    const remaining = new Date(session.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      setForceEnded(true)
      return
    }
    const timer = window.setTimeout(() => setForceEnded(true), remaining + 500)
    return () => window.clearTimeout(timer)
  }, [session, session?.id, session?.status, session?.expiresAt])

  useEffect(() => {
    if (!session) return
    const ended =
      session.status === 'EXPIRED' ||
      !session.question ||
      (session.expiresAt ? new Date(session.expiresAt).getTime() <= Date.now() : false) ||
      forceEnded
    if (ended) stopAudio()
  }, [session, forceEnded, stopAudio])

  useEffect(() => {
    stopAudio()
    setStartedQuestionId(null)
    playRequestRef.current = null
    setAudioError('')
    setAnswerResult(null)
    setSkipPending(false)
    setNextSession(null)
    timeoutSubmittedRef.current = null
    submittedQuestionRef.current = null
  }, [session?.question?.publicId, stopAudio])

  useEffect(() => {
    const sessionId = session?.id
    const sessionStatus = session?.status
    if (!sessionId || sessionStatus === 'COMPLETED' || sessionStatus === 'CHEAT_DETECTED') return
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
    setStartedQuestionId(question.publicId)
    stopAudio()
    window.dispatchEvent(new Event('easmusic:pause-all'))
    setError('')
    setAudioError('')
    setAudioLoading(true)
    const generation = audioGenerationRef.current
    let resolvePlayReady: (ready: boolean) => void = () => undefined
    const playReady = new Promise<boolean>((resolve) => {
      resolvePlayReady = resolve
    })
    const pendingPlay: PendingPlayRequest = { publicId: question.publicId, promise: playReady }
    playRequestRef.current = pendingPlay
    let playRegistered = false
    try {
      const data = await api<{
        audioUrl: string
        durationSeconds: number
        playCount: number
        remainingPlayCount: number
        answerDeadlineAt: string | null
        answerAvailableAt: string | null
        expiresAt: string
        cheatDetected?: boolean
        exitAfterSeconds?: number
      }>(`/api/entertainment/guess-song/sessions/${session.id}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question.publicId,
          requestKey: createUUID(),
          clientSessionToken: session.clientSessionToken,
        }),
      })
      if (generation !== audioGenerationRef.current) {
        resolvePlayReady(false)
        return
      }
      if (data.cheatDetected) {
        resolvePlayReady(false)
        stopAudio()
        setCheatDetected(true)
        setSession((current) => current ? { ...current, status: 'CHEAT_DETECTED', score: 0, isValid: false } : current)
        return
      }
      playRegistered = true
      resolvePlayReady(true)
      setSession((current) => current?.question ? {
        ...current,
        totalPlayCount: current.totalPlayCount + 1,
        expiresAt: data.expiresAt,
        question: {
          ...current.question,
          playCount: data.playCount,
          remainingPlayCount: data.remainingPlayCount,
           answerDeadlineAt: data.answerDeadlineAt,
           answerAvailableAt: data.answerAvailableAt,
        },
      } : current)
      setForceEnded(false)
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
      audio.src = data.audioUrl
      audio.load()
      await audio.play()
    } catch (reason) {
      resolvePlayReady(false)
      if (generation !== audioGenerationRef.current) return
      if (!playRegistered) {
        setStartedQuestionId((current) => current === question.publicId ? null : current)
      }
      setPlaying(false)
      setAudioLoading(false)
      setAudioError(reason instanceof Error ? reason.message : '音频播放失败')
    } finally {
      if (playRequestRef.current === pendingPlay) playRequestRef.current = null
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

  const searchCandidates = useCallback(async (query: string, signal: AbortSignal) => {
    const data = await api<{ candidates: GuessSongCandidate[] }>(
      `/api/entertainment/guess-song/search?q=${encodeURIComponent(query)}`,
      { signal },
    )
    return data.candidates
  }, [])

  function giveUpQuestion() {
    const question = session?.question
    if (!session || !question || question.answerMode !== 'INPUT' || answering || answerResult || submittedQuestionRef.current === question.publicId) return
    setSkipPending(true)
    void submitAnswer({ optionKey: null, answerText: null, skip: true })
  }

  async function submitAnswer(answer: GuessAnswerSubmission) {
    const question = session?.question
    if (!session || !question || answering || answerResult || submittedQuestionRef.current === question.publicId) return
    submittedQuestionRef.current = question.publicId
    setAnswering(true)
    const pendingPlay = playRequestRef.current
    if (pendingPlay?.publicId === question.publicId) {
      const ready = await pendingPlay.promise
      if (!ready) {
        if (submittedQuestionRef.current === question.publicId) submittedQuestionRef.current = null
        if (answer.skip === true) setSkipPending(false)
        setAnswering(false)
        return
      }
    }
    stopAudio()
    setError('')
    try {
      const result = await api<AnswerResult>(`/api/entertainment/guess-song/sessions/${session.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question.publicId,
          ...answer,
          skip: answer.skip === true,
          clientSessionToken: session.clientSessionToken,
          questionAttemptToken: question.questionAttemptToken,
        }),
      })
      if (result.cheatDetected) {
        setCheatDetected(true)
        setSession(result.session)
        setAnswerResult(null)
        setNextSession(null)
        return
      }
      if (answer.skip === true) setSkipPending(false)
      setAnswerResult(result)
      setNextSession(result.session)
      if (result.ranks) finalRanksRef.current = result.ranks
    } catch (reason) {
      if (submittedQuestionRef.current === question.publicId) submittedQuestionRef.current = null
      if (answer.skip === true) setSkipPending(false)
      setError(reason instanceof Error ? reason.message : '答案提交失败')
    } finally {
      setAnswering(false)
    }
  }
  submitAnswerRef.current = (answer) => { void submitAnswer(answer) }

  useEffect(() => {
    const deadline = session?.question?.answerDeadlineAt
    const publicId = session?.question?.publicId
    if (!deadline || !publicId || answerResult) return
    const remaining = new Date(deadline).getTime() - Date.now()
    const timer = window.setTimeout(() => {
      if (timeoutSubmittedRef.current === publicId) return
      timeoutSubmittedRef.current = publicId
      submitAnswerRef.current({ optionKey: null, answerText: null })
    }, Math.max(0, remaining + 100))
    return () => window.clearTimeout(timer)
  }, [answerResult, session?.question?.answerDeadlineAt, session?.question?.publicId])

  useEffect(() => {
    const deadline = session?.question?.answerDeadlineAt
    const availableAt = session?.question?.answerAvailableAt
    if (!deadline || answerResult) {
      setDeadlineSeconds(null)
      return
    }
    const update = () => {
      if (availableAt && new Date(availableAt).getTime() > Date.now()) {
        setDeadlineSeconds(null)
        return
      }
      setDeadlineSeconds(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)))
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [answerResult, session?.question?.answerAvailableAt, session?.question?.answerDeadlineAt])

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

  function requestPause() {
    if (!session || session.status !== 'IN_PROGRESS' || pausing || answering || skipPending || answerResult) return
    setPauseOpen(true)
  }

  async function confirmPause() {
    if (!session || session.status !== 'IN_PROGRESS' || pausing) return
    setPausing(true)
    stopAudio()
    setError('')
    try {
      const data = await api<{ session: SessionState }>(`/api/entertainment/guess-song/sessions/${session.id}/pause`, { method: 'POST' })
      setSession(data.session)
      setAnswerResult(null)
      setNextSession(null)
      setSkipPending(false)
      setPauseOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂停游戏失败，请重试')
    } finally {
      setPausing(false)
    }
  }

  async function resumePausedGame() {
    if (!session || session.status !== 'PAUSED' || resuming) return
    setResuming(true)
    setError('')
    try {
      const data = await api<{ session: SessionState }>(`/api/entertainment/guess-song/sessions/${session.id}/resume`, { method: 'POST' })
      setSession(data.session)
      setAnswerResult(null)
      setNextSession(null)
      setForceEnded(false)
      setStartedQuestionId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复游戏失败，请重试')
    } finally {
      setResuming(false)
    }
  }

  function requestExit() {
    if (session?.status === 'COMPLETED') {
      stopAudio()
      leaveGameRoute()
      return
    }
    setExitOpen(true)
  }

  function handleForceExit() {
    stopAudio()
    if (session && session.status === 'IN_PROGRESS') {
      api(`/api/entertainment/guess-song/sessions/${session.id}/abandon`, { method: 'POST' }).catch(() => undefined)
    }
    leaveGameRoute()
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
        body: JSON.stringify({ mode: session.mode, clientFlowNonce: createUUID() }),
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

  if (cheatDetected || session.status === 'CHEAT_DETECTED') {
    return (
      <main className="guess-play-error game-cheat-screen">
        <section className="game-cheat-dialog" role="alertdialog" aria-modal="true" aria-labelledby="guess-cheat-title" aria-live="assertive">
          <h1 id="guess-cheat-title">检测到异常答题行为</h1>
          <p>本局成绩无效。</p>
          <strong>游戏将在 {cheatCountdown} 秒后退出。</strong>
        </section>
      </main>
    )
  }

  if (session.status === 'COMPLETED') {
    const attempts = session.correctCount + session.wrongCount
    const accuracy = attempts ? Math.round(session.correctCount / attempts * 100) : 0
    const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
    return (
      <main className="guess-settlement">
        <h1>本次挑战结束</h1>
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

  if (session.status === 'PAUSED') {
    const pausedAt = session.pausedAt
      ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(session.pausedAt))
      : '刚刚'
    return (
      <main className="guess-paused-screen">
        <section className="guess-paused-card" role="status" aria-live="polite">
          <h1>游戏已暂停</h1>
          <p>当前游戏进度已安全保存，下次进入听听时可以继续。</p>
          <div className="guess-paused-stats">
            <div><span>当前分数</span><b>{session.score}</b></div>
            <div><span>连续答对</span><b>{session.currentStreak}</b></div>
            <div><span>当前题目</span><b>第 {session.currentPosition} 题</b></div>
          </div>
          <p>暂停时间：{pausedAt}</p>
          {error ? <p className="guess-play-message is-error" role="alert">{error}</p> : null}
          <div className="guess-paused-actions">
            <button type="button" onClick={() => void resumePausedGame()} disabled={resuming}>{resuming ? '恢复中…' : '继续游戏'}</button>
            <button type="button" onClick={leaveGameRoute} disabled={resuming}>返回模式选择</button>
          </div>
        </section>
      </main>
    )
  }

  const question = session.question
  const expired = session.expiresAt ? new Date(session.expiresAt).getTime() <= Date.now() : false
  const gameEnded = session.status === 'EXPIRED' || !question || expired || forceEnded
  if (gameEnded) {
    return (
      <main className="guess-play-error">
        <h1>本次游戏已结束</h1>
        <p>{error || (session.status === 'EXPIRED' || expired ? '本场游戏已超时，请重新开始。' : '当前场次没有可用题目，请重新开始。')}</p>
        <nav>
          <button type="button" onClick={handleForceExit} disabled={exiting}>{exiting ? '正在退出…' : '退出游戏'}</button>
          <button type="button" onClick={() => void restart()} disabled={exiting}>重新开始</button>
        </nav>
      </main>
    )
  }
  const progress = durationSeconds ? elapsedSeconds / durationSeconds * 100 : 0
  const inputEnabled = question.answerMode === 'INPUT'
    && (question.playCount > 0 || startedQuestionId === question.publicId)

  return (
  <main className="games-page games-center-background games-full-width immersive-game-layout guess-play-page">
      <button type="button" className="game-exit-button" onClick={requestExit} aria-label="结束本局">← <span>结束本局</span></button>
      <button type="button" className="game-pause-button" onClick={requestPause} disabled={pausing || answering || skipPending || Boolean(answerResult)} aria-label="暂停游戏">{pausing ? '保存中…' : '暂停游戏'}</button>
      <div className={`guess-play-shell ${answerResult?.answerStatus === 'WRONG' ? 'is-wrong' : ''}`}>
        <GuessHeader
          mode={`${session.modeLabel}模式`}
          position={question.position}
          total={session.totalQuestions}
          score={session.score}
          streak={session.currentStreak}
          remaining={session.totalQuestions ? Math.max(0, session.totalQuestions - question.position) : null}
           lives={session.livesRemaining}
           wrongCount={session.wrongCount}
           maxWrongCount={session.maxWrongCount ?? undefined}
           showLives={question.answerMode === 'INPUT'}
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
          disabled={audioLoading || Boolean(answerResult) || skipPending || (question.remainingPlayCount <= 0 && !audioRef.current)}
          onToggle={() => void toggleAudio()}
        />
        <section className="guess-answer-zone answer-section" aria-label="回答区域">
          {question.answerMode === 'INPUT' ? (
            <div className="guess-expert-status" aria-live="polite">
              <span>答题时间 {deadlineSeconds == null ? '音频结束后开始' : `${deadlineSeconds}s`}</span>
              <span>播放 {question.playCount}/{question.maxPlayCount}</span>
              <span>机会 {session.livesRemaining}/{session.maxWrongCount}</span>
            </div>
          ) : null}
<GuessAnswerInput
  key={question.publicId}
  mode={question.answerMode}
  options={question.options}
  disabled={answering || Boolean(answerResult) || skipPending}
  played={question.playCount > 0}
  inputEnabled={question.answerMode === 'INPUT' ? inputEnabled : undefined}
  wrongPulse={answerResult?.answerStatus === 'WRONG' ? 1 : 0}
  searchCandidates={question.answerMode === 'INPUT' ? searchCandidates : undefined}
  onSubmit={(answer) => void submitAnswer(answer)}
  onGiveUp={question.answerMode === 'INPUT' ? giveUpQuestion : undefined}
 />
          <GuessFooter played={question.playCount > 0} playCount={question.playCount} maxPlayCount={question.maxPlayCount} />
        </section>
        {answerResult || skipPending ? (
          <GuessResultOverlay
            key={question.publicId}
            loading={skipPending && !answerResult}
            correct={answerResult?.correct ?? false}
            skipped={answerResult?.skipped ?? true}
            title={answerResult?.correctSongTitle ?? ''}
            artist={answerResult?.correctSongArtist}
            albumTitle={answerResult?.correctSongAlbumTitle}
            releaseYear={answerResult?.correctSongReleaseYear}
            description={answerResult?.correctSongDescription}
            score={answerResult?.awardedScore ?? 0}
            final={Boolean(answerResult && nextSession?.status === 'COMPLETED')}
            onContinue={continueGame}
          />
        ) : null}
      </div>
      {pauseOpen ? (
        <div className="game-exit-dialog-backdrop" role="presentation">
          <section className="game-exit-dialog guess-session-pause-dialog" role="dialog" aria-modal="true" aria-labelledby="guess-pause-title">
            <h2 id="guess-pause-title">暂停游戏？</h2>
            <p>当前游戏进度会保存，下次进入听听时可以继续游戏。</p>
            <div>
              <button type="button" onClick={() => setPauseOpen(false)} disabled={pausing}>取消</button>
              <button type="button" onClick={() => void confirmPause()} disabled={pausing}>{pausing ? '保存中…' : '确认暂停'}</button>
            </div>
          </section>
        </div>
      ) : null}
      {exitOpen ? (
        <div className="game-exit-dialog-backdrop" role="presentation">
          <section className="game-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="game-exit-title">
            <h2 id="game-exit-title">退出当前游戏？</h2>
            <p>本局未完成的进度将被放弃，之后无法继续恢复。</p>
            <div>
              <button type="button" onClick={() => setExitOpen(false)} disabled={exiting}>继续游戏</button>
              <button type="button" onClick={() => void confirmExit()} disabled={exiting}>{exiting ? '正在退出…' : '确认退出本局'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
