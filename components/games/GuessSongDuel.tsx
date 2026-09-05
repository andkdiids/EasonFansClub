'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DUEL_HEARTBEAT_INTERVAL_MS, DUEL_MODE_RULES, DUEL_ROOM_POLL_INTERVAL_MS, getDuelModeLabel, type DuelMode } from '@/lib/guess-song-duel-config'
import { canApplyDuelAnswerAccepted, canApplyDuelMatchSnapshot, duelQuestionIdentityKey, getDuelQuestionIdentity, sameDuelQuestionIdentity, type DuelQuestionIdentity } from '@/lib/guess-song-duel-client-state'
import type { DuelActiveState, DuelClientCommand, DuelMatchResult, DuelMatchState, DuelOption, DuelRealtimeEvent, DuelRoomState } from '@/lib/guess-song-duel-protocol'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { getFriendDisplayName } from '@/lib/friend-display-name'

type Friend = { id: string; nickname?: string; displayName?: string | null; friendRemark?: string | null; avatarUrl?: string | null; profile?: { displayName?: string | null } | null; equippedBadges?: EquippedBadgeView[]; equippedBadge?: EquippedBadgeView | null }
type DuelStats = { wins: number; participations: number; winRate: number }
type DuelHistoryItem = { result: DuelMatchResult; roomCode: string }
type ApiPayload = { ok?: boolean; message?: string; code?: string; [key: string]: unknown }
type DuelApiError = Error & { code?: string; status?: number }
const emptyActiveDuel: DuelActiveState = { activeRoom: null, activeMatch: null, isInActiveDuel: false }
const duelReconnectDelays = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

function jitteredDuelDelay(baseMs: number) {
  const jitter = baseMs * 0.2 * (Math.random() * 2 - 1)
  return Math.max(250, Math.round(baseMs + jitter))
}

async function api<T extends ApiPayload>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => ({})) as T
  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(payload.message || '请求失败'), { code: payload.code, status: response.status }) as DuelApiError
  }
  return payload
}

function avatar(user: { name: string; avatarUrl: string | null }) {
  return user.avatarUrl
    ? <span className="duel-avatar-image" style={{ backgroundImage: `url(${user.avatarUrl})` }} role="img" aria-label="" />
    : <span className="duel-avatar-fallback">{user.name.slice(0, 1)}</span>
}

function friendName(friend: Friend) {
  return getFriendDisplayName({
    nickname: friend.nickname,
    friendRemark: friend.friendRemark,
    isFriendContext: true,
  })
}

function formatDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return '—'
  const seconds = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function mediaErrorName(error: unknown) {
  return error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : 'UnknownError'
}

function isAudioResourceFailure(audio: HTMLAudioElement, error: unknown) {
  return Boolean(audio.error) || mediaErrorName(error) === 'NotSupportedError' || audio.networkState === 3
}

function logAudioFailure(error: unknown, audio: HTMLAudioElement) {
  if (process.env.NODE_ENV === 'production') return
  console.warn('[guess-song-duel.audio]', {
    name: mediaErrorName(error),
    message: error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '',
    readyState: audio.readyState,
    networkState: audio.networkState,
  })
}

export function GuessSongDuel({ userId, initialInviteToken }: Readonly<{ userId: string; initialInviteToken: string | null }>) {
  const router = useRouter()
  const [rooms, setRooms] = useState<DuelRoomState[]>([])
  const [stats, setStats] = useState<DuelStats>({ wins: 0, participations: 0, winRate: 0 })
  const [history, setHistory] = useState<DuelHistoryItem[]>([])
  const [room, setRoom] = useState<DuelRoomState | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [activeDuel, setActiveDuel] = useState<DuelActiveState>(emptyActiveDuel)
  const [match, setMatch] = useState<DuelMatchState | null>(null)
  const [questionResult, setQuestionResult] = useState<DuelMatchState['questionResult']>(null)
  const [view, setView] = useState<'lobby' | 'room' | 'match' | 'result'>('lobby')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [roomPassword, setRoomPassword] = useState('')
  const [selectedMode, setSelectedMode] = useState<DuelMode>('SCORE')
  const [searchCode, setSearchCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [pendingJoinRoom, setPendingJoinRoom] = useState<DuelRoomState | null>(null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [audioUnlocking, setAudioUnlocking] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [clockTick, setClockTick] = useState(Date.now())
  const [answerPending, setAnswerPending] = useState(false)
  // SCORE per-user answer feedback. Captured from the ANSWER_ACCEPTED event so
  // only the answering player ever sees their own correct/incorrect result.
  // The opponent's socket never receives this event, keeping SCORE isolated.
  const [answerFeedback, setAnswerFeedback] = useState<{
    identity: DuelQuestionIdentity
    options: DuelOption[]
    selectedOptionKey: string
    correct: boolean
    correctOptionKey: string
  } | null>(null)
  const answerFeedbackTimerRef = useRef<number | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const timeSyncTimersRef = useRef<number[]>([])
  const reconnectAttemptRef = useRef(0)
  const stoppedRef = useRef(false)
  const offsetRef = useRef(0)
  const roomIdRef = useRef<string | null>(null)
  const matchIdRef = useRef<string | null>(null)
  const viewRef = useRef<'lobby' | 'room' | 'match' | 'result'>('lobby')
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioQuestionRef = useRef<DuelMatchState['question']>(null)
  const audioSourceRef = useRef<string | null>(null)
  const audioOperationRef = useRef(0)
  const audioUnlockingRef = useRef(false)
  const audioUnlockedRef = useRef(false)
  const audioAttemptedTokenRef = useRef<string | null>(null)
  // 记录已播放音频的题目 token，保证每道题只播放一次，且不会在题目切换残留。
  const playedAudioTokenRef = useRef<string | null>(null)
  const answerPendingRef = useRef<string | null>(null)
  const syncSequenceRef = useRef(0)
  const requestGenerationRef = useRef(0)
  const latestMatchRef = useRef<DuelMatchState | null>(null)
  const finishedHandledMatchIdRef = useRef<string | null>(null)
  const syncRequestRef = useRef<{ key: string; generation: number; controller: AbortController; promise: Promise<void> } | null>(null)
  const createRoomInFlightRef = useRef(false)
  // Keep the Audio element stable while score/presence updates replace the match object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const audioQuestion = useMemo(() => match?.question || null, [match?.question?.publicToken, match?.question?.audioStartAt, match?.question?.audioUrl, match?.question?.preloadAudioUrl])

  const clearQuestionLocalState = useCallback(() => {
    if (answerFeedbackTimerRef.current !== null) window.clearTimeout(answerFeedbackTimerRef.current)
    answerFeedbackTimerRef.current = null
    setAnswerFeedback(null)
    answerPendingRef.current = null
    setAnswerPending(false)
    audioOperationRef.current += 1
    currentAudioRef.current?.pause()
    if (currentAudioRef.current) currentAudioRef.current.currentTime = 0
    audioAttemptedTokenRef.current = null
    playedAudioTokenRef.current = null
  }, [])

  const setDuelError = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : '对决请求失败')
  }, [])

  const resetToLobby = useCallback((reason?: unknown) => {
    requestGenerationRef.current += 1
    syncSequenceRef.current += 1
    syncRequestRef.current?.controller.abort()
    syncRequestRef.current = null
    roomIdRef.current = null
    matchIdRef.current = null
    latestMatchRef.current = null
    finishedHandledMatchIdRef.current = null
    clearQuestionLocalState()
    if (reason) setDuelError(reason)
    setRoom(null)
    setRoomId(null)
    setMatchId(null)
    setActiveDuel(emptyActiveDuel)
    setMatch(null)
    setQuestionResult(null)
    setView('lobby')
    router.replace('/games/guess-song/duel')
  }, [clearQuestionLocalState, router, setDuelError])

  const loadLobby = useCallback(async () => {
    try {
      const [roomData, statData] = await Promise.all([
        api<{ rooms: DuelRoomState[] } & DuelActiveState>('/api/entertainment/guess-song/duel/rooms'),
        api<{ stats: DuelStats; history: DuelHistoryItem[] }>('/api/entertainment/guess-song/duel/stats'),
      ])
      setRooms(roomData.rooms || [])
      setActiveDuel({ activeRoom: roomData.activeRoom || null, activeMatch: roomData.activeMatch || null, isInActiveDuel: Boolean(roomData.isInActiveDuel && roomData.activeRoom && roomData.activeMatch) })
      setStats(statData.stats || { wins: 0, participations: 0, winRate: 0 })
      setHistory(statData.history || [])
      const localStateMatchesServer = Boolean(
        !roomIdRef.current && !matchIdRef.current
        || roomData.activeRoom?.id === roomIdRef.current
          && roomData.activeMatch?.id === matchIdRef.current,
      )
      if (viewRef.current === 'lobby' && (roomIdRef.current || matchIdRef.current) && (!roomData.isInActiveDuel || !localStateMatchesServer)) resetToLobby()
    } catch (reason) {
      setDuelError(reason)
    }
  }, [resetToLobby, setDuelError])

  const applyMatchSnapshot = useCallback((next: DuelMatchState) => {
    if (!canApplyDuelMatchSnapshot(matchIdRef.current, latestMatchRef.current, next)) return false
    const previous = latestMatchRef.current
    const questionChanged = !previous || !sameDuelQuestionIdentity(getDuelQuestionIdentity(previous), getDuelQuestionIdentity(next))
    latestMatchRef.current = next
    setMatch(next)
    setQuestionResult(next.questionResult)
    const mySnapshotPlayer = next.players.find((player) => player.userId === userId)
    if (process.env.NODE_ENV !== 'production' && mySnapshotPlayer?.selectedOptionKey) {
      const identity = getDuelQuestionIdentity(next)
      console.debug('[guess-song-duel.snapshot-selection]', {
        currentQuestionToken: identity.questionToken,
        selectedQuestionToken: identity.questionToken,
        selectedAnswer: mySnapshotPlayer.selectedOptionKey,
        revision: next.revision,
      })
    }
    if (!questionChanged && answerPendingRef.current && next.players.some((player) => player.userId === userId && player.submitted)) {
      answerPendingRef.current = null
      setAnswerPending(false)
    }
    if (questionChanged) {
      // A new authoritative question is an atomic boundary for every local
      // answer/feedback state. The old state must never render against the
      // new question, even if a previous request finishes afterward.
      clearQuestionLocalState()
      setAudioBlocked(false)
      setAudioError('')
    }
    if (next.status === 'FINISHED' || next.status === 'INVALID' || next.status === 'CLOSED') {
      requestGenerationRef.current += 1
      syncRequestRef.current?.controller.abort()
      syncRequestRef.current = null
      setView('result')
      if (finishedHandledMatchIdRef.current !== next.matchId) {
        finishedHandledMatchIdRef.current = next.matchId
        void loadLobby()
      }
    } else {
      setView('match')
    }
    return true
  }, [clearQuestionLocalState, loadLobby, userId])

  const openRoom = useCallback((nextRoom: DuelRoomState) => {
    requestGenerationRef.current += 1
    syncSequenceRef.current += 1
    syncRequestRef.current?.controller.abort()
    syncRequestRef.current = null
    if (nextRoom.status === 'CLOSED' && !nextRoom.matchId) {
      resetToLobby(new Error('房间已过期或已关闭'))
      return
    }
    setError('')
    roomIdRef.current = nextRoom.id
    matchIdRef.current = nextRoom.matchId
    latestMatchRef.current = null
    finishedHandledMatchIdRef.current = null
    setRoom(nextRoom)
    setRoomId(nextRoom.id)
    setMatchId(nextRoom.matchId)
    // A room payload can contain a historical matchId. Only the lobby's
    // unified server response may establish activeDuel; opening a room is
    // not itself proof that the linked Match is still active.
    setActiveDuel(emptyActiveDuel)
    setMatch(null)
    setQuestionResult(null)
    setView(nextRoom.matchId ? 'match' : 'room')
    router.replace(`/games/guess-song/duel?room=${encodeURIComponent(nextRoom.id)}`)
  }, [resetToLobby, router])

  useEffect(() => {
    roomIdRef.current = roomId
    matchIdRef.current = matchId
    viewRef.current = view
  }, [roomId, matchId, view])

  useEffect(() => {
    void loadLobby()
    const queryRoomId = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('room') || ''
    const boot = async () => {
      try {
        if (initialInviteToken) {
          const data = await api<{ room: DuelRoomState }>('/api/entertainment/guess-song/duel/invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteToken: initialInviteToken }),
          })
          openRoom(data.room)
          return
        }
        if (queryRoomId) {
          const data = await api<{ room: DuelRoomState }>(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(queryRoomId)}`)
          if (data.room.host.id === userId || data.room.challenger?.id === userId) openRoom(data.room)
        }
      } catch (reason) {
        setDuelError(reason)
        router.replace('/games/guess-song/duel')
      }
    }
    void boot()
  }, [initialInviteToken, loadLobby, openRoom, router, setDuelError, userId])

  const syncDuelState = useCallback((force = false) => {
    const currentRoomId = roomIdRef.current
    const currentMatchId = matchIdRef.current
    if (!currentRoomId && !currentMatchId) return Promise.resolve()
    const key = currentMatchId ? `match:${currentMatchId}` : `room:${currentRoomId}`
    const existing = syncRequestRef.current
    if (existing?.key === key && !force) return existing.promise
    existing?.controller.abort()
    const controller = new AbortController()
    const sequence = ++syncSequenceRef.current
    const generation = requestGenerationRef.current
    const isCurrentRoom = () => syncSequenceRef.current === sequence && roomIdRef.current === currentRoomId && requestGenerationRef.current === generation && !controller.signal.aborted
    const isCurrentMatch = (requestedMatchId: string) => isCurrentRoom() && matchIdRef.current === requestedMatchId
    const promise = (async () => {
      try {
        if (currentMatchId) {
          const matchData = await api<{ match: DuelMatchState }>(`/api/entertainment/guess-song/duel/matches/${encodeURIComponent(currentMatchId)}`, { signal: controller.signal })
          if (!isCurrentMatch(currentMatchId)) return
          applyMatchSnapshot(matchData.match)
          return
        }

        const roomData = await api<{ room: DuelRoomState }>(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(currentRoomId || '')}`, { signal: controller.signal })
        if (!isCurrentRoom()) return
        const nextRoom = roomData.room
        setRoom(nextRoom)
        if (nextRoom.status === 'CLOSED' && !nextRoom.matchId) {
          resetToLobby(new Error('房间已过期或已关闭'))
          return
        }
        if (nextRoom.matchId) {
          matchIdRef.current = nextRoom.matchId
          setMatchId(nextRoom.matchId)
          setView('match')
          const matchData = await api<{ match: DuelMatchState }>(`/api/entertainment/guess-song/duel/matches/${encodeURIComponent(nextRoom.matchId)}`, { signal: controller.signal })
          if (!isCurrentMatch(nextRoom.matchId)) return
          applyMatchSnapshot(matchData.match)
          return
        }
        matchIdRef.current = null
        latestMatchRef.current = null
        setMatchId(null)
        setMatch(null)
        setQuestionResult(null)
        setView(nextRoom.status === 'PLAYING' ? 'match' : 'room')
      } catch (reason) {
        if (controller.signal.aborted) return
        const code = (reason as DuelApiError)?.code
        if (code === 'STALE_ROUND' || code === 'MATCH_FINISHED') {
          void syncDuelState()
          return
        }
        if (code === 'ROOM_EXPIRED' || code === 'ROOM_NOT_FOUND' || code === 'ROOM_NOT_JOINABLE') {
          resetToLobby(new Error('房间已过期或已关闭'))
        }
      } finally {
        if (syncRequestRef.current?.controller === controller) syncRequestRef.current = null
      }
    })()
    syncRequestRef.current = { key, generation, controller, promise }
    return promise
  }, [applyMatchSnapshot, resetToLobby])

  useEffect(() => {
    if (room?.status === 'PLAYING' && view !== 'match' && view !== 'result') setView('match')
  }, [room?.status, view])

  const handleRealtimeEvent = useCallback((event: DuelRealtimeEvent) => {
    if (event.type === 'TIME_SYNC') {
      const receivedAt = Date.now()
      offsetRef.current = ((event.serverReceivedAt + event.serverSentAt) / 2) - ((event.clientSentAt + receivedAt) / 2)
      socketRef.current?.send(JSON.stringify({ type: 'TIME_SYNC_ACK', requestId: event.requestId } satisfies DuelClientCommand))
      return
    }
    if (event.type === 'ROOM_STATE') {
      setRoom(event.state)
      if (event.state.status === 'CLOSED' && !event.state.matchId) {
        resetToLobby(new Error('房主已离开，房间已关闭'))
        return
      }
      if (event.state.matchId) {
        if (matchIdRef.current !== event.state.matchId) {
          matchIdRef.current = event.state.matchId
          latestMatchRef.current = null
          setMatchId(event.state.matchId)
        }
        setView('match')
        void syncDuelState()
      } else if (event.state.status !== 'CLOSED') {
        setView(event.state.status === 'PLAYING' ? 'match' : 'room')
      }
      return
    }
    if (event.type === 'MATCH_STARTING') {
      if (matchIdRef.current !== event.matchId) {
        matchIdRef.current = event.matchId
        latestMatchRef.current = null
      }
      setMatchId(event.matchId)
      setView('match')
      void syncDuelState()
      return
    }
    if (event.type === 'MATCH_STATE') {
      applyMatchSnapshot(event.state)
      return
    }
    if (event.type === 'QUESTION_START' || event.type === 'PLAYER_ANSWERED' || event.type === 'QUESTION_RESULT' || event.type === 'MATCH_FINISHED' || event.type === 'ANSWER_ACCEPTED') {
      const currentMatch = latestMatchRef.current
      if (event.type === 'ANSWER_ACCEPTED' && event.userId === userId && currentMatch?.mode === 'SCORE' && canApplyDuelAnswerAccepted(currentMatch, event)) {
        // Per-user feedback only: capture the just-answered question so the
        // answerer sees their own correct/incorrect result. The opponent never
        // receives this event, so their options stay untouched.
        const identity = getDuelQuestionIdentity(currentMatch)
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[guess-song-duel.answer-feedback]', {
            currentQuestionToken: identity.questionToken,
            selectedQuestionToken: event.questionToken,
            selectedAnswer: event.selectedOptionKey,
            revision: currentMatch.revision,
          })
        }
        const feedbackQuestion = currentMatch.question
        if (feedbackQuestion) {
          setAnswerFeedback({
            identity,
            options: feedbackQuestion.options,
            selectedOptionKey: event.selectedOptionKey,
            correct: event.correct,
            correctOptionKey: event.correctOptionKey,
          })
          answerPendingRef.current = null
          setAnswerPending(false)
          if (answerFeedbackTimerRef.current) window.clearTimeout(answerFeedbackTimerRef.current)
          answerFeedbackTimerRef.current = window.setTimeout(() => {
            setAnswerFeedback((current) => current && sameDuelQuestionIdentity(current.identity, identity) ? null : current)
          }, 1600)
        }
      }
      void syncDuelState(true)
      return
    }
    if (event.type === 'PLAYER_PRESENCE') {
      void syncDuelState()
      return
    }
    if (event.type === 'ERROR') {
      answerPendingRef.current = null
      setAnswerPending(false)
      if (event.code === 'STALE_ROUND' || event.code === 'MATCH_FINISHED') void syncDuelState()
      else setError(event.message)
    }
  }, [applyMatchSnapshot, resetToLobby, syncDuelState, userId])

  useEffect(() => {
    if (!roomId && !matchId) return
    if (matchId && latestMatchRef.current && latestMatchRef.current.status !== 'PLAYING') return
    stoppedRef.current = false
    const sendHeartbeat = () => {
      const currentSocket = socketRef.current
      if (currentSocket?.readyState === WebSocket.OPEN) {
        currentSocket.send(JSON.stringify({ type: 'PING' } satisfies DuelClientCommand))
      }
    }
    const connect = () => {
      if (stoppedRef.current || socketRef.current || typeof window === 'undefined') return
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws/duel`)
      socketRef.current = socket
      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        for (const timer of timeSyncTimersRef.current) window.clearTimeout(timer)
        timeSyncTimersRef.current = []
        const sync = () => {
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
          socket.send(JSON.stringify({ type: 'TIME_SYNC_REQUEST', requestId, clientSentAt: Date.now() } satisfies DuelClientCommand))
        }
        for (let index = 0; index < 5; index += 1) {
          let timer = 0
          timer = window.setTimeout(() => {
            timeSyncTimersRef.current = timeSyncTimersRef.current.filter((item) => item !== timer)
            if (socket.readyState === WebSocket.OPEN) sync()
          }, index * 80)
          timeSyncTimersRef.current.push(timer)
        }
        if (roomIdRef.current) socket.send(JSON.stringify({ type: 'JOIN_ROOM', roomId: roomIdRef.current } satisfies DuelClientCommand))
        if (matchIdRef.current) socket.send(JSON.stringify({ type: 'JOIN_MATCH', matchId: matchIdRef.current } satisfies DuelClientCommand))
        sendHeartbeat()
      }
      socket.onmessage = (message) => {
        try {
          handleRealtimeEvent(JSON.parse(String(message.data)) as DuelRealtimeEvent)
        } catch {
          // Ignore malformed frames; the HTTP state endpoint remains available for recovery.
        }
      }
      socket.onclose = () => {
        if (socketRef.current !== socket) return
        for (const timer of timeSyncTimersRef.current) window.clearTimeout(timer)
        timeSyncTimersRef.current = []
        socketRef.current = null
        if (stoppedRef.current) return
        const delay = duelReconnectDelays[Math.min(reconnectAttemptRef.current, duelReconnectDelays.length - 1)]
        reconnectAttemptRef.current += 1
        if (navigator.onLine === false || document.visibilityState === 'hidden') return
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          connect()
        }, jitteredDuelDelay(delay))
      }
      socket.onerror = () => socket.close()
    }
    connect()
    const heartbeatTimer = window.setInterval(sendHeartbeat, DUEL_HEARTBEAT_INTERVAL_MS)
    const roomPollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && socketRef.current?.readyState !== WebSocket.OPEN) void syncDuelState()
    }, DUEL_ROOM_POLL_INTERVAL_MS)
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (socketRef.current?.readyState !== WebSocket.OPEN) connect()
      sendHeartbeat()
      void syncDuelState()
    }
    const handleOnline = () => {
      if (!stoppedRef.current && socketRef.current?.readyState !== WebSocket.OPEN) connect()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    void syncDuelState()
    return () => {
      stoppedRef.current = true
      window.clearInterval(heartbeatTimer)
      window.clearInterval(roomPollTimer)
      for (const timer of timeSyncTimersRef.current) window.clearTimeout(timer)
      timeSyncTimersRef.current = []
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
    }
  }, [roomId, matchId, match?.status, handleRealtimeEvent, syncDuelState])

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.controls = false
    currentAudioRef.current = audio
    const handleAudioError = () => {
      const question = audioQuestionRef.current
      if (!question || audioSourceRef.current !== question.audioUrl) return
      logAudioFailure(audio.error, audio)
      setAudioBlocked(true)
      setAudioError('音频资源加载失败，请稍后重试')
    }
    audio.addEventListener('error', handleAudioError)
    return () => {
      audio.removeEventListener('error', handleAudioError)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      currentAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    audioQuestionRef.current = audioQuestion
    const audio = currentAudioRef.current
    if (!audio) return
    if (!audioQuestion || view !== 'match' || audioQuestion.matchId !== matchId) {
      audio.pause()
      return
    }
    audioOperationRef.current += 1
    audioUnlockingRef.current = false
    setAudioUnlocking(false)
    audio.pause()
    audio.currentTime = 0
    audioSourceRef.current = audioQuestion.audioUrl
    audio.src = audioQuestion.audioUrl
    audio.load()
    // 新题只重置该题的播放尝试；整个 Match 的 audioUnlocked 保持不变。
    audioAttemptedTokenRef.current = null
    playedAudioTokenRef.current = null
  }, [audioQuestion, matchId, view])

  useEffect(() => {
    if (view === 'match') return
    audioOperationRef.current += 1
    audioUnlockingRef.current = false
    audioQuestionRef.current = null
    const audio = currentAudioRef.current
    audio?.pause()
    if (audio) {
      audio.removeAttribute('src')
      audio.load()
    }
    audioSourceRef.current = null
  }, [view])

  // 时钟驱动播放门控：只有本地时间（含服务器时钟偏移）到达服务端下发的
  // audioStartAt 才播放，且每道题只播放一次。这保证双方在同一服务器时刻同步
  // 出声——先收到题目的客户端也只会等待，不会提前播放；收到晚也不会错过同步点。
  useEffect(() => {
    if (!audioQuestion || view !== 'match' || audioQuestion.matchId !== matchId) return
    if (playedAudioTokenRef.current === audioQuestion.publicToken || audioAttemptedTokenRef.current === audioQuestion.publicToken) return
    const startAt = new Date(audioQuestion.audioStartAt).getTime()
    if (clockTick + offsetRef.current < startAt) return
    const audio = currentAudioRef.current
    if (!audio) return
    const operation = audioOperationRef.current
    const questionToken = audioQuestion.publicToken
    audioAttemptedTokenRef.current = questionToken
    let playPromise: Promise<void>
    try {
      playPromise = audio.play()
    } catch (reason) {
      if (operation !== audioOperationRef.current || audioQuestionRef.current?.publicToken !== questionToken) return
      logAudioFailure(reason, audio)
      setAudioBlocked(true)
      setAudioError(isAudioResourceFailure(audio, reason) ? '音频资源加载失败，请稍后重试' : '声音开启失败，请点击按钮重试')
      return
    }
    void playPromise.then(() => {
      if (operation !== audioOperationRef.current || audioQuestionRef.current?.publicToken !== questionToken) return
      playedAudioTokenRef.current = questionToken
      audioUnlockedRef.current = true
      setAudioUnlocked(true)
      setAudioBlocked(false)
      setAudioError('')
    }).catch((reason: unknown) => {
      if (operation !== audioOperationRef.current || audioQuestionRef.current?.publicToken !== questionToken) return
      logAudioFailure(reason, audio)
      const resourceFailure = isAudioResourceFailure(audio, reason)
      setAudioBlocked(true)
      setAudioError(resourceFailure ? '音频资源加载失败，请稍后重试' : '声音开启失败，请点击按钮重试')
    })
  }, [audioQuestion, clockTick, matchId, view])

  const unlockAudioForCurrentQuestion = useCallback(() => {
    const audio = currentAudioRef.current
    const question = audioQuestionRef.current
    if (!audio || !question || question.matchId !== matchId || audioUnlockingRef.current) return
    const operation = audioOperationRef.current
    const questionToken = question.publicToken
    audioUnlockingRef.current = true
    setAudioUnlocking(true)
    setAudioError('')
    audioAttemptedTokenRef.current = questionToken
    // This play() call deliberately stays in the click handler's synchronous
    // call chain so mobile autoplay policies can recognize the real gesture.
    let playPromise: Promise<void>
    try {
      playPromise = audio.play()
    } catch (reason) {
      logAudioFailure(reason, audio)
      audioUnlockingRef.current = false
      setAudioUnlocking(false)
      const resourceFailure = isAudioResourceFailure(audio, reason)
      setAudioBlocked(true)
      setAudioError(resourceFailure ? '音频资源加载失败，请稍后重试' : '声音开启失败，请再试一次')
      return
    }
    void playPromise.then(() => {
      if (operation !== audioOperationRef.current || audioQuestionRef.current?.publicToken !== questionToken) return
      audioUnlockingRef.current = false
      audioUnlockedRef.current = true
      setAudioUnlocking(false)
      setAudioUnlocked(true)
      setAudioBlocked(false)
      setAudioError('')
      // The click only unlocks this stable element. Let the normal server-clock
      // playback path start the actual preview, so unlocking never consumes a
      // play attempt or changes the question's scheduled start.
      audio.pause()
      audio.currentTime = 0
      audioAttemptedTokenRef.current = null
      playedAudioTokenRef.current = null
    }).catch((reason: unknown) => {
      if (operation !== audioOperationRef.current || audioQuestionRef.current?.publicToken !== questionToken) return
      logAudioFailure(reason, audio)
      audioUnlockingRef.current = false
      setAudioUnlocking(false)
      const resourceFailure = isAudioResourceFailure(audio, reason)
      setAudioBlocked(true)
      setAudioError(resourceFailure ? '音频资源加载失败，请稍后重试' : '声音开启失败，请再试一次')
    })
  }, [matchId])

  useEffect(() => {
    audioOperationRef.current += 1
    audioUnlockedRef.current = false
    audioUnlockingRef.current = false
    audioQuestionRef.current = null
    audioSourceRef.current = null
    setAudioUnlocked(false)
    setAudioUnlocking(false)
    setAudioBlocked(false)
    setAudioError('')
    audioAttemptedTokenRef.current = null
    playedAudioTokenRef.current = null
    const audio = currentAudioRef.current
    audio?.pause()
    if (audio) {
      audio.removeAttribute('src')
      audio.load()
    }
  }, [matchId])

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [])

  const countdown = useMemo(() => {
    if (!match?.question || match.phase !== 'STARTING') return 0
    return Math.max(0, Math.ceil((new Date(match.question.serverStartedAt).getTime() - (clockTick + offsetRef.current)) / 1000))
  }, [clockTick, match])

  const currentQuestion = match?.question
  const activeMode = match?.mode || room?.mode || selectedMode
  // Room/match state is public shared game state. Never overlay the current
  // viewer's private friend remark onto names received from the duel protocol.
  const getDuelDisplayName = (player: { name: string }) => player.name
  const currentQuestionIdentity = match && currentQuestion ? getDuelQuestionIdentity(match) : null
  const visibleAnswerFeedback = currentQuestionIdentity && answerFeedback && sameDuelQuestionIdentity(answerFeedback.identity, currentQuestionIdentity) ? answerFeedback : null
  const questionInteractionKey = currentQuestionIdentity ? duelQuestionIdentityKey(currentQuestionIdentity) : match ? `${match.matchId}:${match.currentQuestionIndex}:waiting` : 'no-question'
  const audioStarted = Boolean(currentQuestion && clockTick + offsetRef.current >= new Date(currentQuestion.audioStartAt).getTime())
  const deadlinePassed = Boolean(currentQuestion && (activeMode === 'BUZZER' || currentQuestion.isOvertime) && clockTick + offsetRef.current > new Date(currentQuestion.answerDeadlineAt).getTime())
  const me = match?.players.find((player) => player.userId === userId) || null
  const opponent = match?.players.find((player) => player.userId !== userId) || null
  const lastRoundVisible = activeMode === 'BUZZER' && Boolean(match?.lastQuestionResult && currentQuestion && new Date(currentQuestion.serverStartedAt).getTime() > clockTick + offsetRef.current)
  const lastRoundSummary = lastRoundVisible ? match?.lastQuestionResult?.answers.map((answer) => {
    const player = match.players.find((item) => item.userId === answer.userId)
    return `${player ? getDuelDisplayName(player) : '玩家'} ${answer.selectedOptionKey || '未作答'}（${answer.correct ? '正确' : '错误'}）`
  }).join(' · ') : null

  async function createRoom() {
    if (createRoomInFlightRef.current) return
    createRoomInFlightRef.current = true
    setBusy(true)
    setError('')
    try {
      const data = await api<{ room: DuelRoomState }>('/api/entertainment/guess-song/duel/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: roomPassword || undefined, mode: selectedMode }),
      })
      setRoomPassword('')
      openRoom(data.room)
    } catch (reason) {
      setDuelError(reason)
    } finally {
      createRoomInFlightRef.current = false
      setBusy(false)
    }
  }

  async function searchRoom() {
    if (!searchCode.trim()) return
    setBusy(true)
    try {
      const data = await api<{ rooms: DuelRoomState[] }>(`/api/entertainment/guess-song/duel/rooms?q=${encodeURIComponent(searchCode.trim())}`)
      const found = data.rooms[0]
      if (!found) throw new Error('没有找到可加入的对决房间')
      setPendingJoinRoom(found)
      setJoinPassword('')
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function joinRoom(target: DuelRoomState, password?: string) {
    setBusy(true)
    setError('')
    try {
      const data = await api<{ room: DuelRoomState }>(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(target.id)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password || undefined }),
      })
      setPendingJoinRoom(null)
      openRoom(data.room)
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function updateReady(ready: boolean) {
    if (!room) return
    setBusy(true)
    try {
      const data = await api<{ room: DuelRoomState }>(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(room.id)}/ready`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ready }),
      })
      setRoom(data.room)
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function startMatch() {
    if (!room) return
    setBusy(true)
    try {
      const data = await api<{ room: DuelRoomState; matchId: string; serverStartAt: string; match: DuelMatchState }>(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(room.id)}/start`, { method: 'POST' })
      setRoom(data.room)
      matchIdRef.current = data.matchId
      latestMatchRef.current = null
      setMatchId(data.matchId)
      applyMatchSnapshot(data.match)
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function leaveRoomOrMatch() {
    if (!room) return
    if (view === 'match' && matchId) {
      if (!window.confirm('比赛正在进行中。现在退出将可能被判负，确定退出吗？')) return
      setBusy(true)
      try {
        await api(`/api/entertainment/guess-song/duel/matches/${encodeURIComponent(matchId)}/forfeit`, { method: 'POST' })
        void syncDuelState()
      } catch (reason) {
        setDuelError(reason)
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      await api(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(room.id)}/leave`, { method: 'POST' })
      resetToLobby()
      await loadLobby()
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function submitAnswer(optionKey: string) {
    if (!matchId || !currentQuestion || !audioStarted || deadlinePassed || me?.submitted || questionResult) return
    const questionIdentity = getDuelQuestionIdentity(match as DuelMatchState)
    const questionKey = duelQuestionIdentityKey(questionIdentity)
    if (answerPendingRef.current === questionKey) return
    answerPendingRef.current = questionKey
    setAnswerPending(true)
    const clientElapsedMs = Math.max(0, Math.round(Date.now() + offsetRef.current - new Date(currentQuestion.audioStartAt).getTime()))
    const command: DuelClientCommand = {
      type: 'ANSWER',
      matchId,
      roomId: currentQuestion ? match?.roomId || roomId || '' : roomId || '',
      roundId: currentQuestion.roundId,
      questionId: currentQuestion.questionId,
      questionToken: currentQuestion.publicToken,
      answer: optionKey,
      selectedOptionKey: optionKey,
      clientElapsedMs,
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify(command))
      } catch (reason) {
        answerPendingRef.current = null
        setAnswerPending(false)
        setDuelError(reason)
      }
      return
    }
    try {
      await api(`/api/entertainment/guess-song/duel/matches/${encodeURIComponent(matchId)}/answers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      })
      void syncDuelState()
    } catch (reason) {
      answerPendingRef.current = null
      setAnswerPending(false)
      const code = (reason as DuelApiError)?.code
      if (code === 'STALE_ROUND' || code === 'MATCH_FINISHED' || code === 'ANSWER_ALREADY_SUBMITTED') void syncDuelState()
      else setDuelError(reason)
    }
  }

  async function openInvites() {
    setBusy(true)
    try {
      const data = await api<{ friends: Friend[] }>('/api/friends/list?page=1&pageSize=50')
      setFriends(data.friends || [])
      setSelectedFriendId(data.friends?.[0]?.id || '')
      setInviteOpen(true)
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function sendInvite() {
    if (!room || !selectedFriendId) return
    setBusy(true)
    try {
      await api('/api/entertainment/guess-song/duel/invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: room.id, inviteeId: selectedFriendId }),
      })
      setInviteOpen(false)
    } catch (reason) {
      setDuelError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function resetAfterResult() {
    setBusy(true)
    try {
      const currentRoomId = roomIdRef.current || room?.id
      if (currentRoomId) {
        await api(`/api/entertainment/guess-song/duel/rooms/${encodeURIComponent(currentRoomId)}/leave`, { method: 'POST' })
      }
    } catch (reason) {
      const code = (reason as DuelApiError)?.code
      if (!['ROOM_NOT_FOUND', 'ROOM_NOT_MEMBER', 'ROOM_EXPIRED'].includes(code || '')) {
        setDuelError(reason)
      }
    } finally {
      setBusy(false)
    }
    resetToLobby()
    await loadLobby()
  }

  const myReady = room ? room.host.id === userId ? room.hostReady : room.challengerReady : false
  const canStart = Boolean(room && room.host.id === userId && room.challenger && room.hostReady && room.challengerReady)
  const result = match?.result
  const resultWinnerName = result?.winnerId ? result.players.find((player) => player.userId === result.winnerId) : null
  const activeModeLabel = getDuelModeLabel(activeMode)
  const questionProgress = currentQuestion?.isOvertime
    ? `加赛 ${currentQuestion.overtimeIndex || 1}`
    : `第 ${match?.currentQuestionIndex || 1} / ${match?.totalQuestions || 0} 题`

  return (
    <main className="duel-page">
      <header className="duel-topbar">
        <Link href="/games/guess-song" className="duel-back" aria-label="返回听听"><span aria-hidden="true">←</span><b>返回听听</b></Link>
        <div><strong>1v1 对决</strong>{room ? <small>房间 {room.roomCode}</small> : null}</div>
        {view === 'match' ? <span className="duel-live-pill">LIVE</span> : <span className="duel-top-spacer" />}
      </header>

      {error ? <div className="duel-alert" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div> : null}

      {view === 'lobby' ? (
        <section className="duel-lobby">
          {activeDuel.isInActiveDuel && activeDuel.activeRoom && activeDuel.activeMatch ? (
            <div className="duel-active-banner" role="status">
              <span>当前正在进行一场对决，请先结束当前比赛</span>
              <div className="duel-active-banner-actions">
                <button type="button" onClick={() => openRoom(activeDuel.activeRoom as DuelRoomState)}>返回当前对局</button>
                <button type="button" aria-label="重新检查对局状态" title="重新检查对局状态" onClick={() => void loadLobby()}>×</button>
              </div>
            </div>
          ) : null}
          <div className="duel-hero-card">
            <div className="duel-hero-copy">
              <h1>1v1 对决</h1>
              <p>同一间房间，选择考试型比分或真正的实时抢答。</p>
              <p className="duel-hero-tagline">听得快一点，答案也要快一点。</p>
            </div>
            <div className="duel-hero-visual" aria-hidden="true"><strong>1 VS 1</strong><i /></div>
            <div className="duel-stat-strip">
              <div><strong>{stats.wins}</strong><span>胜场</span></div>
              <div><strong>{stats.participations}</strong><span>参与</span></div>
              <div><strong>{stats.winRate}%</strong><span>胜率</span></div>
            </div>
          </div>
          <div className="duel-lobby-grid">
            <section className="duel-panel">
              <h2>创建房间</h2>
              <div className="duel-form-grid">
                <label>房间密码<input value={roomPassword} onChange={(event) => setRoomPassword(event.target.value)} placeholder="可选，4～12 位字母数字" maxLength={12} /></label>
              </div>
              <fieldset className="duel-mode-fieldset">
                <legend>对决模式</legend>
                <div className="duel-mode-options">
                  {(['SCORE', 'BUZZER'] as DuelMode[]).map((mode) => <label key={mode} className={selectedMode === mode ? 'is-selected' : ''}><input type="radio" name="duel-mode" value={mode} checked={selectedMode === mode} onChange={() => setSelectedMode(mode)} /><span><b>{getDuelModeLabel(mode)}</b><small>{mode === 'SCORE' ? '同时作答 30 题，答对更多的一方获胜' : '31 题抢答对决，率先拿下 16 题获胜'}</small></span></label>)}
                </div>
              </fieldset>
              <button type="button" className="duel-primary-button" onClick={() => void createRoom()} disabled={busy}>创建房间</button>
            </section>
            <section className="duel-panel">
              <h2>加入房间</h2>
              <div className="duel-search-row"><input value={searchCode} onChange={(event) => setSearchCode(event.target.value)} placeholder="输入房间号" maxLength={12} /><button type="button" onClick={() => void searchRoom()} disabled={busy}>搜索</button></div>
              {pendingJoinRoom ? <div className="duel-join-card"><div><b>房间 {pendingJoinRoom.roomCode}</b><span>{getDuelModeLabel(pendingJoinRoom.mode)} · <UserDisplayName name={pendingJoinRoom.host.name} uid={pendingJoinRoom.host.uid} badges={pendingJoinRoom.host.equippedBadges} badge={pendingJoinRoom.host.equippedBadge} compact /> · {pendingJoinRoom.currentCount}/2 {pendingJoinRoom.hasPassword ? '· 🔒 需要密码' : ''}</span></div>{pendingJoinRoom.hasPassword ? <input value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="请输入房间密码" maxLength={12} /> : null}<button type="button" className="duel-primary-button" onClick={() => void joinRoom(pendingJoinRoom, joinPassword)} disabled={busy}>加入</button></div> : null}
            </section>
          </div>
          <section className="duel-panel duel-room-list-panel">
            <div className="duel-panel-heading"><div><h2>公开房间</h2><p className="duel-muted">这里只显示未设置密码、等待挑战者的房间。</p></div><button type="button" onClick={() => void loadLobby()}>刷新</button></div>
            {rooms.length ? <div className="duel-room-list">{rooms.map((item) => <div key={item.id} className="duel-room-row"><div className="duel-room-code">{item.roomCode}</div><div className="duel-room-owner"><span className="duel-mini-avatar">{avatar(item.host)}</span><span><UserDisplayName name={item.host.name} uid={item.host.uid} badges={item.host.equippedBadges} badge={item.host.equippedBadge} compact /></span></div><span className="duel-room-mode">{getDuelModeLabel(item.mode)}</span><span className="duel-room-count">{item.currentCount}/2</span><button type="button" onClick={() => void joinRoom(item)} disabled={busy}>加入</button></div>)}</div> : <p className="duel-empty">暂时没有等待中的公开房间，创建一个开始挑战吧。</p>}
          </section>
          {history.length ? <section className="duel-panel"><div className="duel-panel-heading"><h2>我的对决记录</h2><span className="duel-muted">最近 {history.length} 场</span></div><div className="duel-history-list">{history.slice(0, 6).map((item) => <div key={item.result.matchId}><span>{formatDate(item.result.finishedAt || item.result.startedAt)}</span><b>{item.result.players.map((player) => item.result.mode === 'SCORE' ? player.baseCorrectCount : player.correctCount).join(' : ')}</b><em>{item.result.isDraw ? '平局' : item.result.winnerId === userId ? '胜利' : '失败'}</em></div>)}</div></section> : null}
        </section>
      ) : null}

      {view === 'room' && room ? (
        <section className="duel-room-hall">
          <div className="duel-hall-title"><div><h1>听听 · 对决</h1><p className="duel-mode-badge">{getDuelModeLabel(room.mode)}</p><p className="duel-muted">两位玩家都准备后，房主才能开始。</p></div><button type="button" className="duel-ghost-button" onClick={() => void leaveRoomOrMatch()} disabled={busy}>退出房间</button></div>
          <div className="duel-players-card">
            <div className="duel-room-player"><div className="duel-large-avatar">{avatar(room.host)}</div><span className="duel-player-role">房主</span><h2><UserDisplayName name={getDuelDisplayName(room.host)} uid={room.host.uid} badges={room.host.equippedBadges} badge={room.host.equippedBadge} showBadgeName /></h2><p className={room.hostReady ? 'is-ready' : ''}>{room.hostReady ? '✓ 已准备' : '○ 未准备'}</p></div>
            <div className="duel-versus">VS</div>
            <div className="duel-room-player">{room.challenger ? <><div className="duel-large-avatar">{avatar(room.challenger)}</div><span className="duel-player-role">挑战者</span><h2><UserDisplayName name={getDuelDisplayName(room.challenger)} uid={room.challenger.uid} badges={room.challenger.equippedBadges} badge={room.challenger.equippedBadge} showBadgeName /></h2><p className={room.challengerReady ? 'is-ready' : ''}>{room.challengerReady ? '✓ 已准备' : '○ 未准备'}</p></> : <><div className="duel-large-avatar duel-empty-avatar">+</div><span className="duel-player-role">等待加入</span><h2>等待挑战者</h2><p>分享房间号或邀请好友</p></>}</div>
          </div>
          <div className="duel-hall-actions"><button type="button" className="duel-primary-button" onClick={() => void updateReady(!myReady)} disabled={busy || !room.challenger}>{myReady ? '取消准备' : '准备'}</button>{room.host.id === userId ? <button type="button" className="duel-start-button" onClick={() => void startMatch()} disabled={!canStart || busy}>{canStart ? '开始游戏' : '等待双方准备'}</button> : null}<button type="button" className="duel-ghost-button" onClick={() => void openInvites()} disabled={busy || Boolean(room.challenger)}>邀请好友</button></div>
          <p className="duel-rule-note">{DUEL_MODE_RULES[room.mode]} 题目与规则由服务端锁定，重新进入房间也不会改变模式。</p>
        </section>
      ) : null}

      {view === 'match' && !match ? (
        <section className="duel-match-screen">
          <div className="duel-question-card" role="status" aria-live="polite">
            <div className="duel-countdown"><span>对局状态</span><strong>…</strong></div>
            <p className="duel-audio-hint">正在同步对局，请稍候…</p>
            <button type="button" className="duel-primary-button" onClick={() => void syncDuelState()}>重新同步</button>
          </div>
        </section>
      ) : null}

      {view === 'match' && match ? (
        <section className="duel-match-screen">
          <div className="duel-scoreboard"><div className="duel-score-player"><span className="duel-score-avatar">{me ? avatar(me) : null}</span><span>{me ? <UserDisplayName name={getDuelDisplayName(me)} uid={me.uid} badges={me.equippedBadges} badge={me.equippedBadge} compact /> : '我'}</span><strong>{me?.correctCount || 0}</strong><small>{me?.isOnline ? '在线' : '重连中'}</small></div><div className="duel-score-center"><b>{me?.correctCount || 0} <i>:</i> {opponent?.correctCount || 0}</b><span>{activeModeLabel} · {questionProgress}</span></div><div className="duel-score-player is-opponent"><span className="duel-score-avatar">{opponent ? avatar(opponent) : null}</span><span>{opponent ? <UserDisplayName name={getDuelDisplayName(opponent)} uid={opponent.uid} badges={opponent.equippedBadges} badge={opponent.equippedBadge} compact /> : '对手'}</span><strong>{opponent?.correctCount || 0}</strong><small>{opponent?.isOnline ? '在线' : '等待重连'}</small></div></div>
          <div className="duel-question-card">
            {activeMode === 'SCORE' && match.status === 'PLAYING' && me?.submitted && !currentQuestion ? (
              <div className="duel-score-waiting" role="status" aria-live="polite">
                <strong>已完成 {me.answeredCount} / {match.totalQuestions}</strong>
                <p>你已完成答题，等待对方交卷</p>
                <span>对方进度：{opponent?.answeredCount || 0} / {match.totalQuestions}</span>
              </div>
            ) : <div key={questionInteractionKey} className="duel-question-interaction">
            {match.phase === 'STARTING' && countdown > 0 ? <div className="duel-countdown"><span>准备</span><strong>{countdown}</strong></div> : null}
            <div className="duel-question-heading"><span>{currentQuestion?.isOvertime ? `加赛 ${currentQuestion.overtimeIndex || 1}` : `${activeModeLabel} · 第 ${String(match.currentQuestionIndex).padStart(2, '0')} / ${match.totalQuestions} 题`}</span><span>{audioStarted && !deadlinePassed ? activeMode === 'BUZZER' ? '抢答进行中' : '双方独立作答' : deadlinePassed ? '等待揭晓' : '即将开始'}</span></div>
            <p className="duel-audio-hint">试听将在题目开始后 2 秒同步播放 · {activeMode === 'BUZZER' ? '本题最多 1 个得分者' : '双方各有一次独立答题机会'}</p>
            {audioBlocked ? <button type="button" className="duel-audio-unlock" onClick={unlockAudioForCurrentQuestion} disabled={audioUnlocking}>{audioUnlocking ? '正在开启声音…' : audioUnlocked ? '重新开启声音' : '点击开启声音'}</button> : null}
            {audioError ? <p className="duel-audio-error" role="alert">{audioError}</p> : null}
            {visibleAnswerFeedback && activeMode === 'SCORE' ? (
              <>
                <div className="duel-options">{visibleAnswerFeedback.options.map((option) => {
                  const mineRight = visibleAnswerFeedback.correct && visibleAnswerFeedback.selectedOptionKey === option.key
                  const mineWrong = !visibleAnswerFeedback.correct && visibleAnswerFeedback.selectedOptionKey === option.key
                  const isCorrect = visibleAnswerFeedback.correctOptionKey === option.key
                  const label = mineRight ? '我答对了' : mineWrong ? '我的错误选择' : isCorrect ? '正确答案' : ''
                  return <button key={`${questionInteractionKey}:${option.key}`} type="button" className={[mineRight ? 'is-correct-choice' : '', mineWrong ? 'is-wrong-choice' : '', isCorrect ? 'is-correct-choice' : ''].filter(Boolean).join(' ')} disabled aria-label={`${option.label}${label ? `，${label}` : ''}`}><b>{option.key}</b><span>{option.label}</span>{label ? <small>{label}</small> : null}</button>
                })}</div>
                <div className="duel-answer-status">{visibleAnswerFeedback.correct ? '✅ 回答正确！' : `❌ 回答错误，正确答案：${visibleAnswerFeedback.correctOptionKey}`}</div>
              </>
            ) : (
              <>
                <div className="duel-options">{currentQuestion?.options.map((option) => {
                  const mine = me?.selectedOptionKey === option.key
                  const theirs = activeMode === 'BUZZER' && opponent?.selectedOptionKey === option.key
                  const correct = activeMode === 'BUZZER' && questionResult?.correctOptionKey === option.key
                  const mineLabel = activeMode === 'BUZZER' && me?.answerCorrect === false ? '我的错误抢答' : questionResult && me?.answerCorrect !== null ? me?.answerCorrect ? '我答对了' : '我答错了' : '我的选择'
                  const theirsLabel = activeMode === 'BUZZER' && opponent?.answerCorrect === false ? '对方错误抢答' : questionResult && opponent?.answerCorrect !== null ? opponent?.answerCorrect ? '对方答对了' : '对方答错了' : '对方选择'
                  return <button key={`${questionInteractionKey}:${option.key}`} type="button" className={[me?.submitted || Boolean(questionResult) ? 'is-submitted' : '', mine ? 'is-my-choice' : '', theirs ? 'is-opponent-choice' : '', correct ? 'is-correct-choice' : ''].filter(Boolean).join(' ')} onClick={() => void submitAnswer(option.key)} disabled={!audioStarted || deadlinePassed || Boolean(me?.submitted) || Boolean(questionResult) || answerPending} aria-label={`${option.label}${mine ? `，${mineLabel}` : ''}${theirs ? `，${theirsLabel}` : ''}`}><b>{option.key}</b><span>{option.label}</span>{mine ? <small>{mineLabel}</small> : null}{theirs ? <small>{theirsLabel}</small> : null}</button>
                })}</div>
                 <div className="duel-answer-status">{answerPending ? '正在提交答案…' : me?.submitted ? activeMode === 'BUZZER' ? '✓ 已作答，本题资格已锁定' : '✓ 已作答，等待对手' : audioStarted && !deadlinePassed ? '选择一个答案，提交后不可修改' : '请等待题目开始'}{opponent?.submitted ? <span> · 对手已作答</span> : null}</div>
              </>
            )}
             {lastRoundSummary ? <div className="duel-question-result">上一题：{lastRoundSummary}</div> : null}
             {questionResult ? <div className="duel-question-result"><b>本题答案：{questionResult.correctLabel}</b><span>{activeMode === 'BUZZER' ? questionResult.answers.some((answer) => answer.correct) ? '本题已分出胜负' : '本题无人得分' : `${questionResult.answers.filter((answer) => answer.correct).length} 人答对`}</span></div> : null}
            </div>}
          </div>
          <button type="button" className="duel-exit-link" onClick={() => void leaveRoomOrMatch()} disabled={busy}>退出比赛</button>
        </section>
      ) : null}

      {view === 'result' && result ? (
        <section className="duel-result-screen">
          <h1>{result.status === 'INVALID' ? '比赛无效' : result.isDraw ? '平局' : result.winnerId === userId ? '🏆 你赢了' : `${resultWinnerName ? getDuelDisplayName(resultWinnerName) : '对手'}获胜`}</h1>
          <div className="duel-result-score">
            {result.players.map((player) => (
              <div key={player.userId} className={player.userId === result.winnerId ? 'is-winner' : ''}>
                <span><UserDisplayName name={getDuelDisplayName(player)} uid={player.userId === userId ? me?.uid : opponent?.uid} badges={player.userId === userId ? me?.equippedBadges : opponent?.equippedBadges} badge={player.userId === userId ? me?.equippedBadge : opponent?.equippedBadge} compact /></span>
                <strong>{result.mode === 'SCORE' ? player.baseCorrectCount : player.correctCount}</strong>
                <small>{result.mode === 'SCORE' ? `基础正确题数 ${player.baseCorrectCount} / ${result.baseTotalQuestions}` : '最终比分'}</small>
              </div>
            ))}
          </div>
          {result.mode === 'BUZZER' ? <p className="duel-final-score">最终比分：{result.players.map((player) => player.correctCount).join(' : ')}</p> : null}
          <p className="duel-result-reason">{result.status === 'INVALID' ? '有效比赛题目不足，双方不计胜场、参与次数和奖励' : result.isDraw ? '加赛仍未分出胜负' : result.finishReason === 'DISCONNECT' ? '对手在重连保护期内未回来' : result.finishReason === 'FORFEIT' ? '对手主动退出比赛' : result.finishReason === 'SCORE_THRESHOLD' ? '率先拿下 16 题' : result.finishReason === 'TIEBREAKER' ? '加赛分出胜负' : '基础题目完成，答对更多的一方获胜'} · 本场用时 {formatDuration(result.startedAt, result.finishedAt)}</p>
          <div className="duel-reward-card">
            {result.reward.granted && result.reward.amount > 0
              ? <><b>+{result.reward.amount} 挂号费</b><span>今日对决胜利奖励已发放</span></>
              : result.winnerId === userId && result.reward.reason === 'DAILY_LIMIT_REACHED'
                ? <><b>本局获胜</b><span>今日对决奖励已领取，本局未重复发放挂号费</span></>
                : result.winnerId === userId && result.reward.reason === 'REWARD_FAILED'
                  ? <><b>本局获胜</b><span>奖励结算失败，挂号费未到账</span></>
                  : result.winnerId === userId
                    ? <><b>本局获胜</b><span>本场未获得挂号费</span></>
                    : <><b>本场未获得挂号费</b><span>参与次数仅在正常结算后增加</span></>}
          </div>
          <button type="button" className="duel-primary-button" onClick={() => void resetAfterResult()} disabled={busy}>返回对决大厅</button>
        </section>
      ) : null}

      {inviteOpen ? <div className="duel-modal-backdrop"><section className="duel-modal" role="dialog" aria-modal="true"><h2>邀请好友</h2><p className="duel-muted">好友将收到通知，邀请链接不包含房间密码。</p><select value={selectedFriendId} onChange={(event) => setSelectedFriendId(event.target.value)}><option value="">选择好友</option>{friends.map((friend) => <option key={friend.id} value={friend.id}>{friendName(friend)}</option>)}</select><div className="duel-modal-actions"><button type="button" onClick={() => setInviteOpen(false)}>取消</button><button type="button" className="duel-primary-button" onClick={() => void sendInvite()} disabled={!selectedFriendId || busy}>发送邀请</button></div></section></div> : null}
    </main>
  )
}
