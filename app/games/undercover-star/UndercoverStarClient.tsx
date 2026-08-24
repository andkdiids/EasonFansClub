'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UndercoverPrivateState, UndercoverPublicMatchSnapshot, UndercoverRoomMessagePublic, UndercoverRoomState } from '@/lib/undercover-star-protocol'
import type { UndercoverDifficulty } from '@prisma/client'
import { THINKING_DURATION_MS, undercoverDifficultyLabels } from '@/lib/undercover-star-config'
import { canApplyUndercoverPrivateState, canApplyUndercoverRoomState, canApplyUndercoverSnapshot } from '@/lib/undercover-star-client-state'
import { UndercoverStarRealtimeClient, type UndercoverRealtimeStatus } from '@/lib/undercover-star-realtime-client'
import { UndercoverStarChatClient } from '@/lib/undercover-star-chat-realtime-client'
import { UndercoverAvatar as Avatar } from '@/components/games/undercover-star/UndercoverAvatar'
import { UndercoverEntryPanel } from '@/components/games/undercover-star/UndercoverEntryPanel'
import { UndercoverPublicRooms } from '@/components/games/undercover-star/UndercoverPublicRooms'
import { UndercoverProfileCard } from '@/components/games/undercover-star/UndercoverProfileCard'

type LobbyResponse = { rooms: UndercoverRoomState[]; activeRoom: UndercoverRoomState | null; activeMatch: { matchId: string; roomId: string; status: 'PLAYING' | 'FINISHED' } | null; isInActiveGame: boolean }
type LobbyActiveMatch = NonNullable<LobbyResponse['activeMatch']>
type MatchStateResponse = { snapshot: UndercoverPublicMatchSnapshot; privateState: UndercoverPrivateState }
type UndercoverStatsView = { totalGames: number; totalWins: number; totalLosses: number; winRate: number; xp: number; level: number; civilianGames: number; civilianWins: number; undercoverGames: number; undercoverWins: number; successfulUndercoverVotes: number; undercoverSurvivalWins: number; undercoverGuessWins: number }
type VoteUiState = { key: string | null; status: 'idle' | 'submitting' | 'submitted'; targetId: string | null; abstained: boolean }

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试。')
  return payload.data
}

function phaseTitle(phase: UndercoverPublicMatchSnapshot['phase']) {
  return ({ ROLE_REVEAL: '查看你的词', DESCRIBING: '描述阶段', THINKING: '思考阶段', VOTING: '投票阶段', TIE_VOTING: '投票阶段', UNDERCOVER_GUESS: '最后一搏', FINISHED: '本局结果' } as const)[phase]
}

function roleTitle(role: UndercoverPrivateState['role']) {
  return role === 'UNDERCOVER' ? '卧底' : '平民'
}

function useCountdown(deadline: string | null, serverNow: string | null, resetKey: string | null, maxSeconds?: number) {
  const [now, setNow] = useState(() => Date.now())
  const [serverOffset, setServerOffset] = useState(0)
  useEffect(() => {
    if (!serverNow) {
      setServerOffset(0)
      return
    }
    const parsed = new Date(serverNow).getTime()
    setServerOffset(Number.isFinite(parsed) ? parsed - Date.now() : 0)
  }, [serverNow])
  useEffect(() => {
    if (!deadline) return
    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [deadline, resetKey])
  if (!deadline) return null
  const remaining = Math.ceil((new Date(deadline).getTime() - (now + serverOffset)) / 1000)
  return Math.min(maxSeconds ?? Number.MAX_SAFE_INTEGER, Math.max(0, remaining))
}

export function UndercoverStarClient() {
  const [view, setView] = useState<'LOBBY' | 'ROOM' | 'MATCH'>('LOBBY')
  const [rooms, setRooms] = useState<UndercoverRoomState[]>([])
  const [stats, setStats] = useState<UndercoverStatsView | null>(null)
  const [room, setRoom] = useState<UndercoverRoomState | null>(null)
  const [activeRoom, setActiveRoom] = useState<UndercoverRoomState | null>(null)
  const [activeMatch, setActiveMatch] = useState<LobbyResponse['activeMatch']>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<UndercoverPublicMatchSnapshot | null>(null)
  const [privateState, setPrivateState] = useState<UndercoverPrivateState | null>(null)
  const [roomCode, setRoomCode] = useState('')
  const [roomPassword, setRoomPassword] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createDifficulty, setCreateDifficulty] = useState<UndercoverDifficulty>('NORMAL')
  const [description, setDescription] = useState('')
  const [guess, setGuess] = useState('')
  const [voteTarget, setVoteTarget] = useState<string | null>(null)
  const [voteAbstain, setVoteAbstain] = useState(false)
  const [showPrivate, setShowPrivate] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [connectionState, setConnectionState] = useState<'CONNECTED' | 'RECONNECTING' | 'OFFLINE'>('RECONNECTING')
  const [hasFinishedMatch, setHasFinishedMatch] = useState(false)
  const [voteUi, setVoteUi] = useState<VoteUiState>({ key: null, status: 'idle', targetId: null, abstained: false })
  const realtimeRef = useRef<UndercoverStarRealtimeClient | null>(null)
  const snapshotRef = useRef<UndercoverPublicMatchSnapshot | null>(null)
  const roomRef = useRef<UndercoverRoomState | null>(null)
  const voteSubmittingRef = useRef(false)
  const voteKeyRef = useRef<string | null>(null)

  async function loadLobby(resumeActive = true) {
    setLoading(true)
    try {
      const [data, statsData] = await Promise.all([
        request<LobbyResponse>('/api/entertainment/undercover-star/rooms'),
        request<{ stats: UndercoverStatsView }>('/api/entertainment/undercover-star/stats'),
      ])
      setRooms(data.rooms)
      setStats(statsData.stats)
      setActiveRoom(data.activeRoom)
      setActiveMatch(data.activeMatch)
      // 房间生命周期校验：
      // - PLAYING 进行中对局 → 完整恢复（场景1：刷新或重新进入均可）。
      // - WAITING 等候室 → 恢复正常房间视图。
      // - FINISHED / 已退出 / 房间关闭 / 无进行中对局 → 统一进入大厅，
      //   不自动恢复上一局（场景2/3）。大厅会以「查看结果」入口呈现一次，
      //   需用户主动点击，绝不直接渲染游戏页。
      if (!resumeActive) {
        setView('LOBBY')
      } else if (data.activeMatch && data.activeMatch.status === 'PLAYING') {
        roomRef.current = null
        setRoomId(data.activeMatch.roomId)
        setMatchId(data.activeMatch.matchId)
        setView('MATCH')
      } else if (data.activeRoom) {
        roomRef.current = data.activeRoom
        setRoom(data.activeRoom)
        setRoomId(data.activeRoom.roomId)
        setView('ROOM')
      } else {
        setView('LOBBY')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '大厅加载失败。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadLobby() }, [])

  useEffect(() => {
    realtimeRef.current?.stop()
    realtimeRef.current = null
    if (!roomId && !matchId) return
    const client = new UndercoverStarRealtimeClient({
      roomId: matchId ? null : roomId,
      matchId,
      fetchRoom: async (id) => (await request<{ room: UndercoverRoomState }>(`/api/entertainment/undercover-star/rooms/${id}`)).room,
      fetchMatch: async (id) => (await request<{ snapshot: UndercoverPublicMatchSnapshot }>(`/api/entertainment/undercover-star/matches/${id}`)).snapshot,
      onRoom: (state) => {
        if (state.status === 'CANCELLED') {
          roomRef.current = null
          setMessage('房间已关闭，已返回大厅。')
          setRoom(null)
          setHasFinishedMatch(false)
          setRoomId(null)
          setView('LOBBY')
          void loadLobby()
          return
        }
        // Drop stale realtime room states (older lastActivityAt or a broadcast
        // from a room the viewer has already left) so a slow in-flight HTTP
        // response can never hide a newer join/ready/start.
        if (!canApplyUndercoverRoomState(roomRef.current, state)) return
        roomRef.current = state
        setRoom(state)
        setRoomId(state.roomId)
        if (state.matchId) {
          setMatchId(state.matchId)
          setView('MATCH')
        }
      },
      onMatch: (state) => {
        const current = snapshotRef.current
        if (!canApplyUndercoverSnapshot(current, state)) return
        if (state.status === 'FINISHED') setHasFinishedMatch(true)
        snapshotRef.current = state
        setSnapshot(state)
        setRoomId(state.roomId)
        setView('MATCH')
      },
      onStatus: (status: UndercoverRealtimeStatus) => {
        if (status === 'connected') {
          setConnectionState('CONNECTED')
          setMessage((current) => current === '连接不稳定，正在恢复对局状态。' || current === '连接暂时不可用，仍在尝试恢复。' ? '' : current)
          return
        }
        if (status === 'reconnecting' || status === 'connecting') {
          setConnectionState('RECONNECTING')
          setMessage('连接不稳定，正在恢复对局状态。')
          return
        }
        if (status === 'offline') {
          setConnectionState('OFFLINE')
          setMessage('连接暂时不可用，仍在尝试恢复。')
        }
      },
      onError: (reason, code) => {
        // 进入已失效/已销毁的房间：清空房间视图并回大厅，提示「请重新创建」。
        if (reason.includes('房间已失效')) {
          roomRef.current = null
          setRoom(null)
          setHasFinishedMatch(false)
          setRoomId(null)
          setMatchId(null)
          setView('LOBBY')
          void loadLobby()
          return
        }
        const terminalCodes = new Set(['ROOM_DESTROYED', 'ROOM_EXPIRED', 'HOST_TERMINATED', 'GAME_ABORTED', 'INSUFFICIENT_PLAYERS'])
        if (code && terminalCodes.has(code)) {
          setError(code === 'ROOM_EXPIRED' || code === 'ROOM_DESTROYED' ? '房间已结束，请返回大厅。' : '游戏已结束。')
          return
        }
        setError(reason)
      },
      onKicked: () => {
        // 被房主移出：清理本地房间状态、停止该 Room 的 realtime 订阅、返回大厅。
        realtimeRef.current?.stop(); roomRef.current = null; setRoom(null); setActiveRoom(null); setActiveMatch(null); setHasFinishedMatch(false); setRoomId(null); setMatchId(null); setView('LOBBY'); setError(''); setMessage('你已被房主移出房间。'); void loadLobby()
      },
    })
    realtimeRef.current = client
    client.start()
    return () => { client.stop() }
  }, [roomId, matchId])

  useEffect(() => {
    if (!matchId) return
    let cancelled = false
    // Non-host players learn that a match started from a ROOM_STATE broadcast
    // (matchId set) but may not have a match snapshot yet. Fetch the
    // authoritative public snapshot immediately so the view is not stuck on
    // "正在恢复对局…" waiting for a WS MATCH_STATE frame that may be delayed.
    if (!snapshotRef.current) {
      void request<{ snapshot: UndercoverPublicMatchSnapshot }>(`/api/entertainment/undercover-star/matches/${matchId}`).then((data) => {
        if (cancelled) return
        if (canApplyUndercoverSnapshot(snapshotRef.current, data.snapshot)) {
          snapshotRef.current = data.snapshot
          if (data.snapshot.status === 'FINISHED') setHasFinishedMatch(true)
          setSnapshot(data.snapshot)
          setView('MATCH')
        }
      }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '对局状态加载失败。') })
    }
    void request<{ privateState: UndercoverPrivateState }>(`/api/entertainment/undercover-star/matches/${matchId}/private`).then((data) => {
      if (cancelled) return
      if (canApplyUndercoverPrivateState(snapshotRef.current, data.privateState)) setPrivateState(data.privateState)
      if (data.privateState.phase === 'ROLE_REVEAL') setShowPrivate(true)
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '身份信息加载失败。') })
    return () => { cancelled = true }
  }, [matchId, snapshot?.revision, snapshot?.phase])

  // Vote UI is keyed by the server's match/round/stage, never by a render or
  // by the transient busy flag. A new authoritative round clears only the
  // current selection; a server-confirmed vote remains locked for that key.
  useEffect(() => {
    const current = snapshot
    const isVoting = current?.phase === 'VOTING' || current?.phase === 'TIE_VOTING'
    const stage = current?.voteState?.stage || current?.viewerVoteStatus?.stage || privateState?.voteStage || (current?.phase === 'VOTING' ? 'MAIN' : current?.phase === 'TIE_VOTING' ? 'TIE' : null)
    const nextKey = current && isVoting && stage ? `${current.matchId}:${current.round}:${stage}` : null

    if (nextKey !== voteKeyRef.current) {
      voteKeyRef.current = nextKey
      voteSubmittingRef.current = false
      setVoteTarget(null)
      setVoteAbstain(false)
      setVoteUi({ key: nextKey, status: 'idle', targetId: null, abstained: false })
    }
    if (!nextKey || !current) return

    const serverVote = current.viewerVoteStatus
    const hasServerVote = Boolean(serverVote?.hasVoted || privateState?.voteSubmitted)
    if (!hasServerVote) return
    const targetId = serverVote?.targetPlayerId || privateState?.voteTargetId || null
    const abstained = Boolean(serverVote?.abstained || privateState?.voteAbstained)
    voteSubmittingRef.current = false
    setVoteTarget(targetId)
    setVoteAbstain(abstained)
    setVoteUi({ key: nextKey, status: 'submitted', targetId, abstained })
  }, [snapshot, privateState])

  async function createRoom() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const data = await request<{ room: UndercoverRoomState }>('/api/entertainment/undercover-star/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: createPassword, difficulty: createDifficulty }) })
      roomRef.current = data.room; setRoom(data.room); setActiveRoom(data.room); setActiveMatch(null); setHasFinishedMatch(false); setRoomId(data.room.roomId); setMatchId(null); setCreatePassword(''); setView('ROOM')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建房间失败。') } finally { setBusy(false) }
  }

  async function joinRoomByCode(code: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const data = await request<{ room: UndercoverRoomState }>('/api/entertainment/undercover-star/rooms/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: code, password: roomPassword }) })
      roomRef.current = data.room; setRoom(data.room); setActiveRoom(data.room); setActiveMatch(data.room.matchId ? { matchId: data.room.matchId, roomId: data.room.roomId, status: 'PLAYING' } : null); setHasFinishedMatch(false); setRoomId(data.room.roomId); setMatchId(data.room.matchId); setRoomCode(''); setRoomPassword(''); setView(data.room.matchId ? 'MATCH' : 'ROOM')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '加入房间失败。') } finally { setBusy(false) }
  }

  async function joinRoom(event: React.FormEvent) {
    event.preventDefault()
    await joinRoomByCode(roomCode)
  }

  async function roomAction(url: string, body?: Record<string, unknown>) {
    if (busy) return false
    setBusy(true); setError('')
    try {
      const data = await request<{ room?: UndercoverRoomState; match?: MatchStateResponse }>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      if (data.room) { roomRef.current = data.room; setRoom(data.room); setActiveRoom(data.room); setRoomId(data.room.roomId) }
      if (data.match) {
        snapshotRef.current = data.match.snapshot
        setSnapshot(data.match.snapshot)
        setPrivateState(data.match.privateState)
        setActiveMatch({ matchId: data.match.snapshot.matchId, roomId: data.match.snapshot.roomId, status: data.match.snapshot.status === 'FINISHED' ? 'FINISHED' : 'PLAYING' })
        setMatchId(data.match.snapshot.matchId)
        setView('MATCH')
      }
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作暂未成功，请稍候重试。') } finally { setBusy(false) }
  }

  async function leaveWaitingRoom() {
    if (!roomId) return
    const succeeded = await roomAction(`/api/entertainment/undercover-star/rooms/${roomId}/leave`)
    if (!succeeded) return
    realtimeRef.current?.stop(); roomRef.current = null; setRoom(null); setActiveRoom(null); setActiveMatch(null); setHasFinishedMatch(false); setRoomId(null); setMatchId(null); setView('LOBBY'); await loadLobby()
  }

  async function leaveCurrentMatch() {
    if (busy || !roomId) return
    setBusy(true); setError('')
    try {
      await request<{ left: boolean }>(`/api/entertainment/undercover-star/rooms/${roomId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      realtimeRef.current?.stop()
      roomRef.current = null
      clearMatchClientState(); setRoom(null); setActiveRoom(null); setActiveMatch(null); setHasFinishedMatch(false); setRoomId(null); setMatchId(null); setView('LOBBY')
      await loadLobby(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出本局失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function kickPlayer(targetUserId: string) {
    if (!roomId) return
    await roomAction(`/api/entertainment/undercover-star/rooms/${roomId}/kick`, { userId: targetUserId })
  }

  async function matchAction(url: string, body: Record<string, unknown>) {
    if (busy || !matchId) return false
    setBusy(true); setError('')
    try {
      const data = await request<MatchStateResponse>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (canApplyUndercoverSnapshot(snapshotRef.current, data.snapshot)) { snapshotRef.current = data.snapshot; setSnapshot(data.snapshot) }
      if (canApplyUndercoverPrivateState(snapshotRef.current, data.privateState)) setPrivateState(data.privateState)
      if (data.snapshot.status === 'FINISHED') {
        setHasFinishedMatch(true)
        realtimeRef.current?.stop()
      }
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : '提交暂未成功，请稍候重试。'); return false } finally { setBusy(false) }
  }

  async function submitVote(targetId: string | null, abstained: boolean) {
    const current = snapshotRef.current || snapshot
    if (!current || !matchId || (current.phase !== 'VOTING' && current.phase !== 'TIE_VOTING') || !privateState?.canVote) return false
    const stage = current.voteState?.stage || current.viewerVoteStatus?.stage || privateState.voteStage || (current.phase === 'VOTING' ? 'MAIN' : 'TIE')
    const key = `${current.matchId}:${current.round}:${stage}`
    // The current round key may be observed before the syncing effect has
    // rendered once.  Only reject a known different key; an empty UI key is
    // the normal first-click case and must not require a second click.
    if (voteSubmittingRef.current || (voteKeyRef.current && voteKeyRef.current !== key) || (voteUi.key && voteUi.key !== key) || voteUi.status === 'submitted' || current.viewerVoteStatus?.hasVoted || privateState.voteSubmitted) return false
    if (!abstained && !targetId) return false
    if (busy) return false

    // The ref is the immediate, render-independent lock. React state is used
    // only for rendering, so a second click cannot enter before setState lands.
    voteSubmittingRef.current = true
    setVoteUi({ key, status: 'submitting', targetId, abstained })
    const succeeded = await matchAction(`/api/entertainment/undercover-star/matches/${current.matchId}/votes`, {
      ...(abstained ? { abstain: true } : { targetId }),
      expectedRevision: current.revision,
      expectedRound: current.round,
    })
    if (!succeeded) {
      voteSubmittingRef.current = false
      setVoteUi({ key, status: 'idle', targetId: null, abstained: false })
      return false
    }
    const authoritative = snapshotRef.current
    const serverVote = authoritative?.viewerVoteStatus
    if (authoritative && authoritative.round === current.round && (authoritative.phase === 'VOTING' || authoritative.phase === 'TIE_VOTING') && serverVote?.hasVoted) {
      const confirmedTarget = serverVote.targetPlayerId || targetId
      const confirmedAbstain = Boolean(serverVote.abstained || abstained)
      setVoteUi({ key, status: 'submitted', targetId: confirmedTarget, abstained: confirmedAbstain })
    } else {
      // If this was the last vote, the authoritative snapshot may already be
      // in the next describing round; the round-key effect will clear the UI.
      voteSubmittingRef.current = false
    }
    return true
  }

  const countdown = useCountdown(
    snapshot?.phaseDeadline || null,
    snapshot?.serverNow || null,
    snapshot ? `${snapshot.phase}:${snapshot.round}:${snapshot.revision}` : null,
    snapshot?.phase === 'THINKING' ? THINKING_DURATION_MS / 1000 : undefined,
  )
  useEffect(() => {
    if (snapshot?.phase !== 'THINKING' || countdown !== 0) return
    // 仅请求权威快照；阶段推进仍由服务端 advanceExpiredUndercoverMatch 决定。
    realtimeRef.current?.syncMatchState()
  }, [countdown, snapshot?.phase, snapshot?.revision])
  const currentRoundDescriptions = useMemo(() => snapshot?.descriptions.filter((item) => item.round === snapshot.round) || [], [snapshot])
  const aliveOthers = snapshot?.players.filter((player) => player.isAlive && player.playerId !== privateState?.playerId) || []
  const voteOptions = snapshot?.phase === 'TIE_VOTING' ? aliveOthers.filter((player) => snapshot.tieCandidates.includes(player.playerId)) : aliveOthers
  const currentSpeaker = snapshot?.players.find((player) => player.playerId === snapshot.currentSpeakerId)

  function clearMatchClientState() {
    voteSubmittingRef.current = false
    voteKeyRef.current = null
    setVoteUi({ key: null, status: 'idle', targetId: null, abstained: false })
    setVoteTarget(null)
    setVoteAbstain(false)
    snapshotRef.current = null
    setSnapshot(null)
    setPrivateState(null)
  }

  async function returnToRoom() {
    if (!roomId) {
      resetToLobby()
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await request<{ room: UndercoverRoomState }>(`/api/entertainment/undercover-star/rooms/${roomId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      realtimeRef.current?.stop()
      clearMatchClientState()
      roomRef.current = data.room
      setRoom(data.room)
      setActiveRoom(data.room)
      setActiveMatch(null)
      setMatchId(null)
      setRoomId(data.room.roomId)
      setView('ROOM')
      setMessage('已返回房间，请重新准备下一局。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '返回房间失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function leaveRoomAndReturnToLobby() {
    if (!roomId) {
      resetToLobby()
      return
    }
    await leaveWaitingRoom()
  }

  function resetToLobby() {
    const status: LobbyActiveMatch['status'] = snapshot?.status === 'FINISHED' ? 'FINISHED' : 'PLAYING'
    // FINISHED 本局不保留「继续对局」入口：返回大厅即彻底退出，结束页面只展示一次。
    const resumableMatch = matchId && roomId && status === 'PLAYING' ? { matchId, roomId, status } : null
    realtimeRef.current?.stop(); clearMatchClientState(); roomRef.current = null; setRoom(null); setHasFinishedMatch(false); setRoomId(null); setMatchId(null); setView('LOBBY'); setError(''); setMessage(''); if (resumableMatch?.roomId) setActiveMatch(resumableMatch); void loadLobby(false)
  }

  function resumeActiveGame() {
    if (activeMatch) {
      roomRef.current = null
      setRoomId(activeMatch.roomId)
      setMatchId(activeMatch.matchId)
      setView('MATCH')
    } else if (activeRoom) {
      roomRef.current = activeRoom
      setRoom(activeRoom)
      setRoomId(activeRoom.roomId)
      setView('ROOM')
    }
  }

  if (loading) return (
    <main className="games-page games-full-width">
      <div className="games-page-inner undercover-star-page">
        <p className="undercover-star-loading text-sm font-bold">正在加载卧底巨星…</p>
      </div>
    </main>
  )

  return (
    <main className="games-page games-full-width">
      <div className="games-page-inner undercover-star-page">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-sky-100 pb-5"><div><Link href="/games" className="text-sm font-black text-brand-700">← 返回娱乐天空</Link><h1 className="mt-5 text-3xl font-black tracking-tight text-brand-950 sm:text-4xl">卧底巨星</h1><p className="mt-2 text-sm font-bold text-slate-500">谁说得最像真的，谁就最可疑。</p></div>{view !== 'LOBBY' ? <button type="button" onClick={() => void leaveRoomAndReturnToLobby()} className="border border-sky-200 px-4 py-2 text-sm font-black text-brand-700">返回大厅</button> : null}</header>
      {message ? <p role="status" className={`mb-4 p-3 text-sm font-black ${connectionState === 'CONNECTED' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{message}</p> : null}
      {error ? <p role="alert" className="mb-4 bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
      {view === 'LOBBY' ? (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="lg:order-2">
              <UndercoverPublicRooms rooms={rooms} onJoinRoom={(next) => void joinRoomByCode(next.roomCode)} onRefresh={() => void loadLobby(false)} />
            </div>
            <div className="lg:order-1">
              <UndercoverEntryPanel roomCode={roomCode} password={roomPassword} createPassword={createPassword} createDifficulty={createDifficulty} busy={busy} onRoomCode={setRoomCode} onPassword={setRoomPassword} onCreatePassword={setCreatePassword} onDifficulty={(value) => setCreateDifficulty(value)} onCreate={() => void createRoom()} onJoin={joinRoom} />
            </div>
          </div>
          <UndercoverProfileCard stats={stats} activeMatch={activeMatch} activeRoom={activeRoom} onViewHistory={resumeActiveGame} />
        </div>
      ) : null}
      {view === 'ROOM' && room ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <Room room={room} isRematch={hasFinishedMatch} busy={busy} onReady={(ready) => void roomAction(`/api/entertainment/undercover-star/rooms/${room.roomId}/ready`, { ready })} onStart={() => void roomAction(`/api/entertainment/undercover-star/rooms/${room.roomId}/start`)} onLeave={() => void leaveWaitingRoom()} onKick={(targetUserId) => void kickPlayer(targetUserId)} onDifficulty={(value) => void roomAction(`/api/entertainment/undercover-star/rooms/${room.roomId}/difficulty`, { difficulty: value })} />
          <RoomChat roomId={room.roomId} viewerUserId={room.viewerUserId} />
        </div>
      ) : null}
      {view === 'MATCH' && snapshot && privateState ? <Match snapshot={snapshot} privateState={privateState} currentRoundDescriptions={currentRoundDescriptions} currentSpeaker={currentSpeaker} voteOptions={voteOptions} countdown={countdown} showPrivate={showPrivate} description={description} guess={guess} voteTarget={voteTarget} voteAbstain={voteAbstain} voteUiSubmitting={voteUi.status === 'submitting'} voteUiSubmitted={voteUi.status === 'submitted'} voteUiTarget={voteUi.targetId} voteUiAbstained={voteUi.abstained} busy={busy} onShowPrivate={setShowPrivate} onDescription={setDescription} onGuess={setGuess} onVoteTarget={(value) => { setVoteTarget(value); setVoteAbstain(false) }} onConfirmRole={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/role-confirm`, { expectedRevision: snapshot.revision })} onDescriptionSubmit={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/descriptions`, { content: description, expectedRevision: snapshot.revision, expectedRound: snapshot.round }).then((success) => { if (success) setDescription('') })} onVoteSubmit={(targetId, abstained) => void submitVote(targetId, abstained)} onGuessSubmit={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/guess`, { guess, expectedRevision: snapshot.revision }).then((success) => { if (success) setGuess('') })} onBack={returnToRoom} onLeave={leaveCurrentMatch} /> : view === 'MATCH' ? <div className="border border-sky-100 bg-white p-6 text-sm font-bold text-slate-500">正在恢复对局…</div> : null}
      </div>
    </main>
  )
}

function RoomChat({ roomId, viewerUserId }: { roomId: string; viewerUserId: string | null }) {
  const [messages, setMessages] = useState<UndercoverRoomMessagePublic[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setChatError] = useState('')
  const [newCount, setNewCount] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const chatClientRef = useRef<UndercoverStarChatClient | null>(null)
  const EMOJIS = ['😀', '😂', '😍', '👍', '🎉', '🔥', '😅', '🤔']

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    nearBottomRef.current = true
  }, [])

  // 仅当用户当前在底部附近时才自动跟随；主动上翻历史时（near-bottom 失效）不强制拉到底部。
  useEffect(() => { if (nearBottomRef.current) scrollToBottom() }, [messages, scrollToBottom])

  // 等候聊天室走独立实时频道（undercover-chat）：进入房间先 HTTP 拉取最近 50 条历史，
  // 之后由 WS 增量追加；WS 断开时客户端自动 HTTP 兜底轮询恢复，不依赖页面轮询。
  useEffect(() => {
    let cancelled = false
    const client = new UndercoverStarChatClient({
      roomId,
      fetchMessages: async (id) => (await request<{ messages: UndercoverRoomMessagePublic[] }>(`/api/entertainment/undercover-star/rooms/${id}/messages`)).messages,
      onHistory: (loaded) => {
        if (cancelled) return
        setMessages(loaded)
        setNewCount(0)
        requestAnimationFrame(scrollToBottom)
      },
      onChatMessage: (message) => {
        if (cancelled) return
        // 按 message.id 去重，避免 POST 响应与 ROOM_CHAT_MESSAGE 广播重复显示自己的消息。
        setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]))
        // 不在底部（正在看历史）时不强制滚动，改为累计「X条新消息」提示。
        if (!nearBottomRef.current) setNewCount((count) => count + 1)
      },
      onError: (reason) => { if (!cancelled) setChatError(reason) },
    })
    chatClientRef.current = client
    client.start()
    return () => {
      cancelled = true
      client.stop()
      chatClientRef.current = null
      setMessages([])
      setDraft('')
      setChatError('')
      setNewCount(0)
    }
  }, [roomId, scrollToBottom])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (nearBottomRef.current && newCount > 0) setNewCount(0)
  }

  async function sendMessage(content: string) {
    const text = content.trim()
    if (!text || sending) return
    setSending(true); setChatError('')
    try {
      const data = await request<{ message: UndercoverRoomMessagePublic }>(`/api/entertainment/undercover-star/rooms/${roomId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) })
      setMessages((prev) => (prev.some((item) => item.id === data.message.id) ? prev : [...prev, data.message]))
      setNewCount(0)
      if (!nearBottomRef.current) scrollToBottom()
      return data.message
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : '发送失败。')
      return null
    } finally {
      setSending(false)
    }
  }

  async function send() {
    const sent = await sendMessage(draft)
    if (sent) setDraft('')
  }

  // 表情即时发送：点击即发，不进入草稿、不刷新页面、不重新拉取聊天记录。
  function insertEmoji(emoji: string) {
    void sendMessage(emoji)
  }

  return (
    <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-lg font-black text-brand-950">等候聊天室</h3>
      <div className="relative">
        <div ref={listRef} onScroll={onScroll} className="mt-3 max-h-72 space-y-3 overflow-y-auto touch-action-pan-y pr-1">
          {messages.length === 0 ? <p className="py-6 text-center text-sm font-bold text-slate-400">还没有人说话，来打个招呼吧～</p> : messages.map((message) => (
            <div key={message.id} className="flex gap-2">
              {message.avatarUrl ? <Image src={message.avatarUrl} alt="" width={32} height={32} unoptimized className="size-8 shrink-0 rounded-full object-cover" /> : <span className="size-8 flex shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-brand-700">{message.name.slice(0, 1)}</span>}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2"><span className="truncate text-xs font-black text-brand-700">{message.name}{message.userId === viewerUserId ? '（我）' : ''}</span><span className="shrink-0 text-[10px] font-bold text-slate-400">{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
                <p className={`break-words text-sm font-bold leading-6 ${message.userId === viewerUserId ? 'text-brand-800' : 'text-slate-700'}`}>{message.content}</p>
              </div>
            </div>
          ))}
        </div>
        {newCount > 0 ? (
          <button type="button" onClick={() => { scrollToBottom(); setNewCount(0) }} className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-950 px-4 py-1.5 text-xs font-black text-white shadow-lg">
            {newCount} 条新消息 ↓
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 bg-red-50 p-2 text-xs font-black text-red-700">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1">
        {EMOJIS.map((emoji) => <button key={emoji} type="button" disabled={sending} onClick={() => insertEmoji(emoji)} className="rounded border border-sky-100 px-2 py-1 text-base leading-none disabled:opacity-50">{emoji}</button>)}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 200))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} maxLength={200} rows={1} placeholder="说点什么…（最多 200 字）" className="max-h-24 min-h-[2.5rem] flex-1 resize-none border border-sky-100 px-3 py-2 text-sm font-bold outline-none focus:border-brand-400" />
        <button type="button" disabled={sending || !draft.trim()} onClick={() => void send()} className="shrink-0 bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">发送</button>
      </div>
    </section>
  )
}

function Room({ room, isRematch, busy, onReady, onStart, onLeave, onKick, onDifficulty }: { room: UndercoverRoomState; isRematch: boolean; busy: boolean; onReady: (ready: boolean) => void; onStart: () => void; onLeave: () => void; onKick: (targetUserId: string) => void; onDifficulty: (value: UndercoverDifficulty) => void }) {
  const allReady = room.players.length >= 3 && room.players.every((player) => player.isReady)
  const me = room.players.find((player) => player.userId === room.viewerUserId)
  const isHost = Boolean(me?.isHost)
  const [difficulty, setDifficulty] = useState<UndercoverDifficulty>(room.difficulty)
  useEffect(() => { setDifficulty(room.difficulty) }, [room.difficulty])
  async function changeDifficulty(value: UndercoverDifficulty) { if (busy || value === difficulty) return; setDifficulty(value); try { await onDifficulty(value) } catch { setDifficulty(room.difficulty) } }
  return <section className="space-y-5"><div className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className=" text-2xl font-black text-brand-950">房间 {room.roomCode}</h2><p className="mt-2 text-sm font-bold text-slate-500">{room.hasPassword ? '私密房间' : '公开房间'} · {room.currentCount} / {room.maxPlayers} 人 · 难度 {undercoverDifficultyLabels[difficulty]}</p></div><div className="text-right text-xs font-bold text-slate-500">{room.players.length < 3 ? '至少需要 3 名玩家才能开始。' : allReady ? '所有玩家已准备。' : '等待所有玩家准备。'}</div></div><div className="mt-7 space-y-2"><p className="text-xs font-black text-slate-500">房间玩家 {room.currentCount} / {room.maxPlayers}</p>{room.players.map((player) => <div key={player.playerId} className={`flex items-center gap-3 border p-3 ${player.isHost ? 'bg-sky-50/40' : 'border-sky-100'}`}><Avatar user={player} small /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="min-w-0 truncate text-sm font-black text-brand-950">{player.name}</span><span className="shrink-0 text-xs font-bold text-slate-400">Lv.{player.level}</span></div><div className={`mt-0.5 text-xs font-black ${player.isHost ? 'text-brand-700' : player.isReady ? 'text-emerald-700' : 'text-slate-400'}`}>{player.isHost ? '房主' : player.isReady ? '已准备' : '未准备'}</div></div>{isHost && !player.isHost ? <button type="button" disabled={busy} onClick={() => onKick(player.userId)} className="shrink-0 border border-red-200 px-3 py-1.5 text-xs font-black text-red-700">踢出</button> : null}</div>)}</div><div className="mt-6 border border-sky-100 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-black text-slate-500">房间难度</span>{isHost ? <select value={difficulty} disabled={busy} onChange={(event) => void changeDifficulty(event.target.value as UndercoverDifficulty)} className="border border-sky-100 px-3 py-2 text-sm font-bold">{['EASY','NORMAL','HARD'].map((value) => <option key={value} value={value}>{undercoverDifficultyLabels[value as UndercoverDifficulty]}</option>)}</select> : <span className="text-sm font-bold text-slate-700">{undercoverDifficultyLabels[difficulty]}</span>}</div></div><div className="mt-6 flex flex-wrap gap-3"><button type="button" disabled={busy || !me} onClick={() => onReady(!(me?.isReady || false))} className="bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{me?.isReady ? '取消准备' : '准备'}</button>{isHost ? <button type="button" disabled={busy || !allReady} onClick={onStart} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{isRematch ? '开始下一局' : '开始游戏'}</button> : null}<button type="button" disabled={busy} onClick={onLeave} className="border border-red-200 px-5 py-3 text-sm font-black text-brand-700">退出房间</button></div></div><p className="border-l-2 border-amber-400 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">房主退出后，等待房会立即关闭；对局开始后可以通过刷新页面恢复观看。</p></section>
}

function Match({ snapshot, privateState, currentRoundDescriptions, currentSpeaker, voteOptions, countdown, showPrivate, description, guess, voteTarget, voteAbstain, voteUiSubmitting, voteUiSubmitted, voteUiTarget, voteUiAbstained, busy, onShowPrivate, onDescription, onGuess, onVoteTarget, onConfirmRole, onDescriptionSubmit, onVoteSubmit, onGuessSubmit, onBack, onLeave }: { snapshot: UndercoverPublicMatchSnapshot; privateState: UndercoverPrivateState; currentRoundDescriptions: UndercoverPublicMatchSnapshot['descriptions']; currentSpeaker?: UndercoverPublicMatchSnapshot['players'][number]; voteOptions: UndercoverPublicMatchSnapshot['players']; countdown: number | null; showPrivate: boolean; description: string; guess: string; voteTarget: string | null; voteAbstain: boolean; voteUiSubmitting: boolean; voteUiSubmitted: boolean; voteUiTarget: string | null; voteUiAbstained: boolean; busy: boolean; onShowPrivate: (value: boolean) => void; onDescription: (value: string) => void; onGuess: (value: string) => void; onVoteTarget: (value: string | null) => void; onConfirmRole: () => void; onDescriptionSubmit: () => void; onVoteSubmit: (targetId: string | null, abstained: boolean) => void; onGuessSubmit: () => void; onBack: () => void; onLeave: () => void }) {
  const isFinished = snapshot.status === 'FINISHED' || snapshot.phase === 'FINISHED'
  const serverVote = snapshot.viewerVoteStatus
  const voteHasSubmitted = privateState.voteSubmitted || serverVote.hasVoted || voteUiSubmitted
  const submittedTargetId = serverVote.targetPlayerId || privateState.voteTargetId || voteUiTarget
  const submittedTargetName = submittedTargetId ? snapshot.players.find((player) => player.playerId === submittedTargetId)?.name || '该玩家' : ''
  const submittedAbstained = Boolean(serverVote.abstained || privateState.voteAbstained || voteUiAbstained)
  useEffect(() => {
    if (privateState.roleConfirmed) onShowPrivate(false)
  }, [onShowPrivate, privateState.roleConfirmed])
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-sky-100 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-brand-700">第 {snapshot.round} 轮 · {phaseTitle(snapshot.phase)}</p>
            <h2 className="mt-1 text-xl font-black text-brand-950">卧底巨星</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <span className="text-sm font-black text-brand-700">{countdown === null ? '—' : `${countdown}s`}</span>
            <button type="button" onClick={() => onShowPrivate(!showPrivate)} className="border border-sky-200 px-3 py-2 text-xs font-black text-brand-700">{showPrivate ? '隐藏我的词' : '查看我的词'}</button>
            {!isFinished ? <button type="button" disabled={busy} onClick={onLeave} className="border border-red-200 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50">退出本局</button> : null}
          </div>
        </div>
        {(snapshot.phase === 'ROLE_REVEAL' || showPrivate) && !isFinished ? (
          <section className="mx-auto max-w-md border border-sky-100 bg-white px-5 py-4 text-center shadow-sm sm:px-7">
            <p className="text-xs font-black tracking-[0.16em] text-slate-500">你的词</p>
            {showPrivate ? <p className="mt-2 text-2xl font-black text-brand-950">{privateState.word}</p> : <p className="mt-2 text-xl font-black text-slate-400">词已隐藏</p>}
            <button type="button" disabled={busy || (snapshot.phase === 'ROLE_REVEAL' && privateState.roleConfirmed)} onClick={snapshot.phase === 'ROLE_REVEAL' ? onConfirmRole : () => onShowPrivate(false)} className="mt-8 w-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{snapshot.phase === 'ROLE_REVEAL' ? (privateState.roleConfirmed ? '已确认，等待其他玩家' : '我知道了') : '关闭私密信息'}</button>
          </section>
        ) : null}
        {!isFinished && snapshot.phase !== 'ROLE_REVEAL' ? (
          <>
            <section className="border border-sky-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-black text-brand-950">玩家状态</h3>
                <span className="text-xs font-bold text-slate-500">已投票 {snapshot.voteProgress.submitted} / {snapshot.voteProgress.total}</span>
              </div>
              <div className="mt-4 space-y-2">
                {snapshot.players.map((player) => (
                  <div key={player.playerId} className={`flex items-center gap-3 border p-3 ${player.playerId === snapshot.currentSpeakerId ? 'border-amber-400 bg-amber-50' : 'border-sky-100'} ${!player.isAlive ? 'opacity-45' : ''}`}>
                    <Avatar user={player} small />
                    <span className="min-w-0 flex-1 truncate text-sm font-black text-brand-950">{player.name}</span>
                    <small className="shrink-0 text-xs font-bold text-slate-500">{!player.isAlive ? '已淘汰' : player.playerId === snapshot.currentSpeakerId ? '正在描述' : '存活'}</small>
                  </div>
                ))}
              </div>
            </section>
            {snapshot.phase === 'DESCRIBING' ? (
              <section className="border border-sky-100 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black text-brand-950">轮到谁描述？</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">{currentSpeaker ? `当前：${currentSpeaker.name}` : '等待服务端推进。'} · 不能直接说出自己的词语。</p>
                <p className="mt-5 bg-sky-50 p-3 text-sm font-bold text-brand-700">请在右侧发言区写下你的描述。</p>
              </section>
            ) : null}
            {snapshot.phase === 'THINKING' ? (
              <section className="border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <h3 className="text-lg font-black text-amber-950">本轮描述结束</h3>
                <p className="mt-2 text-sm font-bold text-amber-900">想想谁最可疑……</p>
                <p className="mt-4 text-sm font-black text-amber-900">{countdown === null ? '—' : `${countdown} 秒后开始投票`}</p>
              </section>
            ) : null}
            {snapshot.phase === 'VOTING' || snapshot.phase === 'TIE_VOTING' ? (
              <section className="border border-sky-100 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black text-brand-950">谁最可疑？</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">所有人投完前不会显示票数与投票对象。</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {voteOptions.map((player) => (
                    <button type="button" key={player.playerId} disabled={voteHasSubmitted || voteUiSubmitting || !privateState.canVote} onClick={() => { onVoteTarget(player.playerId) }} className={`flex items-center gap-3 border p-3 text-left ${voteTarget === player.playerId ? 'border-brand-600 bg-sky-50' : 'border-sky-100'} disabled:cursor-not-allowed disabled:opacity-60`}>
                      <Avatar user={player} small />
                      <span className="min-w-0 flex-1 truncate text-sm font-black text-brand-950">{player.name}</span>
                      {voteTarget === player.playerId ? <span className="text-xs font-black text-brand-700">已选</span> : null}
                    </button>
                  ))}
                </div>
                <button type="button" disabled={voteHasSubmitted || voteUiSubmitting || !privateState.canVote} onClick={() => onVoteSubmit(null, true)} className={`mt-3 flex w-full items-center justify-center gap-2 border p-3 text-sm font-black ${voteAbstain ? 'border-brand-600 bg-sky-50 text-brand-700' : 'border-sky-100 text-slate-700'} disabled:cursor-not-allowed disabled:opacity-60`}>弃权（本轮不投任何人）</button>
                {voteUiSubmitting ? (
                  <p className="mt-5 bg-sky-50 p-3 text-sm font-black text-brand-700">提交中…</p>
                ) : voteHasSubmitted ? (
                  <p className="mt-5 bg-emerald-50 p-3 text-sm font-black text-emerald-700">✓ {submittedAbstained ? '已弃票' : `已投给 ${submittedTargetName}`}，等待其他玩家投票…</p>
                ) : privateState.canVote ? (
                  <button type="button" disabled={busy || (!voteTarget && !voteAbstain)} onClick={() => onVoteSubmit(voteTarget, voteAbstain)} className="mt-5 bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40">确认提交</button>
                ) : (
                  <p className="mt-5 bg-slate-50 p-3 text-sm font-bold text-slate-500">本轮投票已结束，正在进入下一轮。</p>
                )}
              </section>
            ) : null}
            {snapshot.phase === 'UNDERCOVER_GUESS' ? (
              <section className="border border-red-200 bg-red-50 p-5 shadow-sm">
                {snapshot.viewerUndercoverFound ? (
                  <>
                    <h3 className="text-lg font-black text-red-900">你被发现了</h3>
                    <p className="mt-2 text-sm font-bold leading-6 text-red-800">现在只有一次机会猜出平民的词。猜中即可翻盘。</p>
                    <input value={guess} onChange={(event) => onGuess(event.target.value)} maxLength={80} className="mt-5 block w-full border border-red-200 bg-white p-3 text-sm font-bold" placeholder="输入你认为的平民词" />
                    <button type="button" disabled={busy || !guess.trim()} onClick={onGuessSubmit} className="mt-4 bg-red-800 px-5 py-3 text-sm font-black text-white disabled:opacity-40">提交猜词</button>
                  </>
                ) : (
                  <p className="mt-2 text-sm font-bold text-red-800">卧底正在进行最后猜词，其他玩家请等待结果。</p>
                )}
              </section>
            ) : null}
          </>
        ) : null}
        {isFinished && snapshot.finalResult ? <Finished snapshot={snapshot} onReturnRoom={onBack} onLeaveRoom={onLeave} /> : null}
      </section>
      <SpeechRoom snapshot={snapshot} currentRoundDescriptions={currentRoundDescriptions} currentSpeaker={currentSpeaker} countdown={countdown} description={description} onDescription={onDescription} onDescriptionSubmit={onDescriptionSubmit} busy={busy} privateState={privateState} />
    </div>
  )

}

function SpeechRoom({ snapshot, currentRoundDescriptions, currentSpeaker, countdown, description, onDescription, onDescriptionSubmit, busy, privateState }: { snapshot: UndercoverPublicMatchSnapshot; currentRoundDescriptions: UndercoverPublicMatchSnapshot['descriptions']; currentSpeaker?: UndercoverPublicMatchSnapshot['players'][number]; countdown: number | null; description: string; onDescription: (value: string) => void; onDescriptionSubmit: () => void; busy: boolean; privateState: UndercoverPrivateState }) {
  const isFinished = snapshot.status === 'FINISHED' || snapshot.phase === 'FINISHED'
  const pastRounds = snapshot.descriptionHistory.filter((entry) => entry.round < snapshot.round)
  const isDescribing = snapshot.phase === 'DESCRIBING'
  const isThinking = snapshot.phase === 'THINKING'
  const canViewCurrentRound = isDescribing || isThinking || snapshot.phase === 'VOTING' || snapshot.phase === 'TIE_VOTING'
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => setExpanded(!mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  useEffect(() => {
    const el = listRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [pastRounds, currentRoundDescriptions])
  useEffect(() => {
    if (isThinking) setExpanded(true)
  }, [isThinking])
  function onScroll() {
    const el = listRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }
  if (isFinished) return null
  return (
    <section className="border border-sky-100 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-3 border-b border-sky-100 px-4 py-3">
        <h3 className="text-base font-black text-brand-950">发言区</h3>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs font-black text-brand-700 lg:hidden">{expanded ? '收起 ▲' : '展开全部发言 ▼'}</button>
      </div>
      <div ref={listRef} onScroll={onScroll} className={`${expanded || isThinking ? 'block' : 'hidden'} lg:block max-h-[60vh] space-y-4 overflow-y-auto p-4`}>
        {pastRounds.length === 0 && currentRoundDescriptions.length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-slate-400">还没有人发言。</p>
        ) : null}
        {pastRounds.map((entry) => (
          <div key={entry.round}>
            <p className="text-xs font-black tracking-wide text-slate-400">第 {entry.round} 轮</p>
            <div className="mt-2 space-y-2">
              {entry.descriptions.length === 0 ? (
                <p className="text-xs font-bold text-slate-400">暂无发言</p>
              ) : entry.descriptions.map((item) => (
                <div key={`${item.round}-${item.playerId}`} className="border-l-2 border-sky-300 bg-sky-50/50 p-2">
                  <strong className="text-xs font-black text-brand-700">{item.name}</strong>
                  <p className="mt-1 break-words text-sm font-bold text-brand-950">{item.content}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {canViewCurrentRound ? (
          <div>
            <p className={`text-xs font-black tracking-wide ${isThinking ? 'text-amber-700' : 'text-emerald-700'}`}>第 {snapshot.round} 轮（{isThinking ? '描述结束' : snapshot.phase === 'DESCRIBING' ? '进行中' : '本轮记录'}）</p>
            <div className="mt-2 space-y-2">
              {currentRoundDescriptions.length === 0 ? (
                <p className="text-xs font-bold text-slate-400">等待发言…</p>
              ) : currentRoundDescriptions.map((item) => (
                <div key={`${item.round}-${item.playerId}`} className="border-l-2 border-emerald-300 bg-emerald-50/50 p-2">
                  <strong className="text-xs font-black text-emerald-700">{item.name}</strong>
                  <p className="mt-1 break-words text-sm font-bold text-brand-950">{item.content}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="border-t border-sky-100 p-4">
        {currentSpeaker && isDescribing ? (
          <p className="mb-2 text-xs font-black text-emerald-700">当前发言：{currentSpeaker.name}（正在描述）</p>
        ) : null}
        {isDescribing && privateState.canDescribe ? (
          <div>
            <textarea value={description} onChange={(event) => onDescription(event.target.value)} maxLength={30} rows={3} className="block w-full resize-none border border-sky-100 p-3 text-sm font-bold outline-none focus:border-brand-400" placeholder="用一句话描述你的词（最多 30 字）" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">{description.length} / 30</span>
              <button type="button" disabled={busy || !description.trim()} onClick={onDescriptionSubmit} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40">提交描述</button>
            </div>
          </div>
        ) : isDescribing ? (
          <p className="text-xs font-bold text-slate-400">等待其他玩家描述，提交后不能修改。</p>
        ) : isThinking ? (
          <div className="border border-amber-200 bg-amber-50 p-3 text-sm font-black text-amber-900">
            <p>本轮描述结束</p>
            <p className="mt-1">想想谁最可疑……</p>
            <p className="mt-2">{countdown === null ? '—' : `${countdown} 秒后开始投票`}</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Finished({ snapshot, onReturnRoom, onLeaveRoom }: { snapshot: UndercoverPublicMatchSnapshot; onReturnRoom: () => void; onLeaveRoom: () => void }) {
  const result = snapshot.finalResult
  if (!result) return null
  const nameById = new Map(snapshot.players.map((player) => [player.playerId, player.name]))
  return <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7"><h2 className=" text-3xl font-black text-brand-950">{result.winner === 'UNDERCOVER' ? '卧底胜利' : '平民胜利'}</h2><p className="mt-2 text-sm font-bold text-slate-500">{result.reason === 'UNDERCOVER_GUESS_CORRECT' ? '卧底猜中了平民词，成功翻盘。' : result.reason === 'UNDERCOVER_SURVIVAL' ? '卧底存活到最后两人。' : result.reason === 'UNDERCOVER_GUESS_TIMEOUT' ? '卧底超时未能猜词。' : result.reason === 'UNDERCOVER_EXIT' ? '卧底主动退出，平民直接获胜。' : '卧底没有猜中平民词。'}</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="border border-sky-100 p-4"><span className="text-xs font-black text-slate-500">平民词</span><strong className="mt-2 block break-words text-xl font-black text-brand-950">{result.civilianWord}</strong></div><div className="border border-red-100 bg-red-50/50 p-4"><span className="text-xs font-black text-red-700">卧底词</span><strong className="mt-2 block break-words text-xl font-black text-red-900">{result.undercoverWord}</strong></div></div><div className="mt-5 space-y-2">{result.players.map((player) => <div key={player.playerId} className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-50 py-3"><span className="text-sm font-black text-brand-950">{nameById.get(player.playerId) || '玩家'}</span><span className={`text-xs font-black ${player.role === 'UNDERCOVER' ? 'text-red-700' : 'text-slate-600'}`}>{roleTitle(player.role)} · {player.isAlive ? '存活到最后' : '已淘汰'} · 获得 {player.totalVotesReceived} 票</span></div>)}</div><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onReturnRoom} className="bg-brand-950 px-5 py-3 text-sm font-black text-white">返回房间</button><button type="button" onClick={onLeaveRoom} className="border border-sky-200 px-5 py-3 text-sm font-black text-brand-700">返回大厅</button></div></section>
}
