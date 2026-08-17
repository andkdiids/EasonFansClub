'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UndercoverDescriptionByRound, UndercoverPrivateState, UndercoverPublicMatchSnapshot, UndercoverRoomMessagePublic, UndercoverRoomState } from '@/lib/undercover-star-protocol'
import type { UndercoverDifficulty } from '@prisma/client'
import { undercoverDifficultyLabels } from '@/lib/undercover-star-config'
import { canApplyUndercoverPrivateState, canApplyUndercoverRoomState, canApplyUndercoverSnapshot } from '@/lib/undercover-star-client-state'
import { UndercoverStarRealtimeClient } from '@/lib/undercover-star-realtime-client'

type LobbyResponse = { rooms: UndercoverRoomState[]; activeRoom: UndercoverRoomState | null; activeMatch: { matchId: string; roomId: string; status: 'PLAYING' | 'FINISHED' } | null; isInActiveGame: boolean }
type LobbyActiveMatch = NonNullable<LobbyResponse['activeMatch']>
type MatchStateResponse = { snapshot: UndercoverPublicMatchSnapshot; privateState: UndercoverPrivateState }
type UndercoverStatsView = { totalGames: number; totalWins: number; totalLosses: number; winRate: number; xp: number; level: number; civilianGames: number; civilianWins: number; undercoverGames: number; undercoverWins: number; successfulUndercoverVotes: number; undercoverSurvivalWins: number; undercoverGuessWins: number }

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试。')
  return payload.data
}

function phaseTitle(phase: UndercoverPublicMatchSnapshot['phase']) {
  return ({ ROLE_REVEAL: '查看你的词', DESCRIBING: '描述阶段', VOTING: '投票阶段', TIE_VOTING: '平票加赛', UNDERCOVER_GUESS: '最后一搏', FINISHED: '本局结果' } as const)[phase]
}

function roleTitle(role: UndercoverPrivateState['role']) {
  return role === 'UNDERCOVER' ? '卧底' : '平民'
}

function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [deadline])
  if (!deadline) return null
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000))
}

function Avatar({ user, small = false }: { user: { name: string; avatarUrl: string | null }; small?: boolean }) {
  return user.avatarUrl ? <Image src={user.avatarUrl} alt="" width={small ? 36 : 48} height={small ? 36 : 48} unoptimized className={`${small ? 'size-9' : 'size-12'} shrink-0 rounded-full object-cover`} /> : <span className={`${small ? 'size-9' : 'size-12'} flex shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-black text-brand-700`}>{user.name.slice(0, 1)}</span>
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
  const realtimeRef = useRef<UndercoverStarRealtimeClient | null>(null)
  const chatMessageRef = useRef<((message: UndercoverRoomMessagePublic) => void) | null>(null)
  const snapshotRef = useRef<UndercoverPublicMatchSnapshot | null>(null)
  const roomRef = useRef<UndercoverRoomState | null>(null)

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
      if (resumeActive && data.activeMatch) {
        roomRef.current = null
        setRoomId(data.activeMatch.roomId)
        setMatchId(data.activeMatch.matchId)
        setView('MATCH')
      } else if (resumeActive && data.activeRoom) {
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
        snapshotRef.current = state
        setSnapshot(state)
        setRoomId(state.roomId)
        setView('MATCH')
      },
      onStatus: (status) => { if (status === 'disconnected') setMessage('实时连接暂时中断，正在恢复对局状态。') },
      onError: (reason) => setError(reason),
      onChatMessage: (message) => chatMessageRef.current?.(message),
      onKicked: () => {
        // 被房主移出：清理本地房间状态、停止该 Room 的 realtime 订阅、返回大厅。
        realtimeRef.current?.stop(); roomRef.current = null; setRoom(null); setActiveRoom(null); setActiveMatch(null); setRoomId(null); setMatchId(null); setView('LOBBY'); setError(''); setMessage('你已被房主移出房间。'); void loadLobby()
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

  async function createRoom() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const data = await request<{ room: UndercoverRoomState }>('/api/entertainment/undercover-star/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: createPassword, difficulty: createDifficulty }) })
      roomRef.current = data.room; setRoom(data.room); setActiveRoom(data.room); setActiveMatch(null); setRoomId(data.room.roomId); setMatchId(null); setCreatePassword(''); setView('ROOM')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建房间失败。') } finally { setBusy(false) }
  }

  async function joinRoomByCode(code: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const data = await request<{ room: UndercoverRoomState }>('/api/entertainment/undercover-star/rooms/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: code, password: roomPassword }) })
      roomRef.current = data.room; setRoom(data.room); setActiveRoom(data.room); setActiveMatch(data.room.matchId ? { matchId: data.room.matchId, roomId: data.room.roomId, status: 'PLAYING' } : null); setRoomId(data.room.roomId); setMatchId(data.room.matchId); setRoomPassword(''); setView(data.room.matchId ? 'MATCH' : 'ROOM')
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败。') } finally { setBusy(false) }
  }

  async function leaveWaitingRoom() {
    if (!roomId) return
    const succeeded = await roomAction(`/api/entertainment/undercover-star/rooms/${roomId}/leave`)
    if (!succeeded) return
    realtimeRef.current?.stop(); roomRef.current = null; setRoom(null); setActiveRoom(null); setActiveMatch(null); setRoomId(null); setMatchId(null); setView('LOBBY'); await loadLobby()
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
      setVoteTarget(null)
      setVoteAbstain(false)
      if (data.snapshot.status === 'FINISHED') realtimeRef.current?.stop()
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : '提交失败。'); return false } finally { setBusy(false) }
  }

  const countdown = useCountdown(snapshot?.phaseDeadline || null)
  const currentRoundDescriptions = useMemo(() => snapshot?.descriptions.filter((item) => item.round === snapshot.round) || [], [snapshot])
  const aliveOthers = snapshot?.players.filter((player) => player.isAlive && player.playerId !== privateState?.playerId) || []
  const voteOptions = snapshot?.phase === 'TIE_VOTING' ? aliveOthers.filter((player) => snapshot.tieCandidates.includes(player.playerId)) : aliveOthers
  const currentSpeaker = snapshot?.players.find((player) => player.playerId === snapshot.currentSpeakerId)

  function resetToLobby() {
    const status: LobbyActiveMatch['status'] = snapshot?.status === 'FINISHED' ? 'FINISHED' : 'PLAYING'
    const resumableMatch = matchId && roomId ? { matchId, roomId, status } : null
    realtimeRef.current?.stop(); snapshotRef.current = null; roomRef.current = null; setSnapshot(null); setPrivateState(null); setRoom(null); setRoomId(null); setMatchId(null); setView('LOBBY'); setError(''); setMessage(''); if (resumableMatch?.roomId) setActiveMatch(resumableMatch); void loadLobby(false)
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
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-sky-100 pb-5"><div><Link href="/games" className="text-sm font-black text-brand-700">← 返回娱乐天空</Link><h1 className="mt-5 text-3xl font-black tracking-tight text-brand-950 sm:text-4xl">卧底巨星</h1><p className="mt-2 text-sm font-bold text-slate-500">谁说得最像真的，谁就最可疑。</p></div>{view !== 'LOBBY' ? <button type="button" onClick={resetToLobby} className="border border-sky-200 px-4 py-2 text-sm font-black text-brand-700">返回大厅</button> : null}</header>
      {message ? <p role="status" className="mb-4 bg-amber-50 p-3 text-sm font-black text-amber-800">{message}</p> : null}
      {error ? <p role="alert" className="mb-4 bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
      {view === 'LOBBY' && (activeMatch || activeRoom) ? <section className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 p-4"><div><p className="text-sm font-black text-amber-900">{activeMatch?.status === 'FINISHED' ? '上一局卧底巨星已结算' : '你有一局尚未结束的卧底巨星'}</p><p className="mt-1 text-xs font-bold text-amber-800">{activeMatch?.status === 'FINISHED' ? '可以重新查看本局结果。' : '可以继续当前房间，不会重置对局进度。'}</p></div><button type="button" onClick={resumeActiveGame} className="bg-amber-800 px-4 py-2 text-sm font-black text-white">{activeMatch?.status === 'FINISHED' ? '查看结果' : '继续对局'}</button></section> : null}
      {view === 'LOBBY' ? <Lobby rooms={rooms} stats={stats} roomCode={roomCode} password={roomPassword} createPassword={createPassword} busy={busy} onRoomCode={setRoomCode} onPassword={setRoomPassword} onCreatePassword={setCreatePassword} onCreate={() => void createRoom()} onJoin={joinRoom} onJoinRoom={(next) => void joinRoomByCode(next.roomCode)} onRefresh={() => void loadLobby(false)} createDifficulty={createDifficulty} onDifficulty={(value) => setCreateDifficulty(value)} /> : null}
      {view === 'ROOM' && room ? (
        <>
          <Room room={room} busy={busy} onReady={(ready) => void roomAction(`/api/entertainment/undercover-star/rooms/${room.roomId}/ready`, { ready })} onStart={() => void roomAction(`/api/entertainment/undercover-star/rooms/${room.roomId}/start`)} onLeave={() => void leaveWaitingRoom()} onKick={(targetUserId) => void kickPlayer(targetUserId)} onDifficulty={(value) => void roomAction(`/api/entertainment/undercover-star/rooms/${room.roomId}/difficulty`, { difficulty: value })} />
          <RoomChat roomId={room.roomId} viewerUserId={room.viewerUserId} registerChat={(handler) => { chatMessageRef.current = handler; return () => { if (chatMessageRef.current === handler) chatMessageRef.current = null } }} />
        </>
      ) : null}
      {view === 'MATCH' && snapshot && privateState ? <Match snapshot={snapshot} privateState={privateState} currentRoundDescriptions={currentRoundDescriptions} currentSpeaker={currentSpeaker} voteOptions={voteOptions} countdown={countdown} showPrivate={showPrivate} description={description} guess={guess} voteTarget={voteTarget} voteAbstain={voteAbstain} busy={busy} onShowPrivate={setShowPrivate} onVoteAbstain={setVoteAbstain} onDescription={setDescription} onGuess={setGuess} onVoteTarget={setVoteTarget} onConfirmRole={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/role-confirm`, { expectedRevision: snapshot.revision })} onDescriptionSubmit={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/descriptions`, { content: description, expectedRevision: snapshot.revision, expectedRound: snapshot.round }).then((success) => { if (success) setDescription('') })} onVoteSubmit={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/votes`, voteAbstain ? { abstain: true, expectedRevision: snapshot.revision, expectedRound: snapshot.round } : { targetId: voteTarget, expectedRevision: snapshot.revision, expectedRound: snapshot.round })} onGuessSubmit={() => void matchAction(`/api/entertainment/undercover-star/matches/${snapshot.matchId}/guess`, { guess, expectedRevision: snapshot.revision }).then((success) => { if (success) setGuess('') })} onBack={resetToLobby} /> : view === 'MATCH' ? <div className="border border-sky-100 bg-white p-6 text-sm font-bold text-slate-500">正在恢复对局…</div> : null}
      </div>
    </main>
  )
}

function RoomChat({ roomId, viewerUserId, registerChat }: { roomId: string; viewerUserId: string | null; registerChat: (handler: (message: UndercoverRoomMessagePublic) => void) => () => void }) {
  const [messages, setMessages] = useState<UndercoverRoomMessagePublic[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setChatError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const EMOJIS = ['😀', '😂', '😍', '👍', '🎉', '🔥', '😅', '🤔']

  useEffect(() => {
    let cancelled = false
    void request<{ messages: UndercoverRoomMessagePublic[] }>(`/api/entertainment/undercover-star/rooms/${roomId}/messages`).then((data) => {
      if (cancelled) return
      setMessages(data.messages)
      nearBottomRef.current = true
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight })
    }).catch((reason: unknown) => { if (!cancelled) setChatError(reason instanceof Error ? reason.message : '聊天记录加载失败。') })
    const handler = (message: UndercoverRoomMessagePublic) => {
      // 按 message.id 去重，避免 POST 响应与 ROOM_CHAT_MESSAGE 广播重复显示自己的消息。
      setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]))
    }
    const unregister = registerChat(handler)
    // 离开房间/被踢/解散/开始游戏：组件卸载即清理本地消息与草稿（reconnect 时重新拉取历史）。
    return () => { cancelled = true; unregister(); setMessages([]); setDraft(''); setChatError('') }
  }, [roomId, registerChat])

  const scrollToBottom = useCallback(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [])

  // 仅当用户当前在底部附近时才自动跟随；主动上翻历史时（near-bottom 失效）不强制拉到底部。
  useEffect(() => { if (nearBottomRef.current) scrollToBottom() }, [messages, scrollToBottom])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  function insertEmoji(emoji: string) {
    setDraft((prev) => (prev + emoji).slice(0, 200))
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setChatError('')
    try {
      const data = await request<{ message: UndercoverRoomMessagePublic }>(`/api/entertainment/undercover-star/rooms/${roomId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) })
      setMessages((prev) => (prev.some((item) => item.id === data.message.id) ? prev : [...prev, data.message]))
      setDraft('')
    } catch (reason) { setChatError(reason instanceof Error ? reason.message : '发送失败。') } finally { setSending(false) }
  }

  return (
    <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-lg font-black text-brand-950">等候聊天室</h3>
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
      {error ? <p role="alert" className="mt-2 bg-red-50 p-2 text-xs font-black text-red-700">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1">
        {EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)} className="rounded border border-sky-100 px-2 py-1 text-base leading-none">{emoji}</button>)}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 200))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} maxLength={200} rows={1} placeholder="说点什么…（最多 200 字）" className="max-h-24 min-h-[2.5rem] flex-1 resize-none border border-sky-100 px-3 py-2 text-sm font-bold outline-none focus:border-brand-400" />
        <button type="button" disabled={sending || !draft.trim()} onClick={() => void send()} className="shrink-0 bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">发送</button>
      </div>
    </section>
  )
}

function Lobby({ rooms, stats, roomCode, password, createPassword, busy, onRoomCode, onPassword, onCreatePassword, onCreate, onJoin, onJoinRoom, onRefresh, createDifficulty, onDifficulty }: { rooms: UndercoverRoomState[]; stats: UndercoverStatsView | null; roomCode: string; password: string; createPassword: string; busy: boolean; onRoomCode: (value: string) => void; onPassword: (value: string) => void; onCreatePassword: (value: string) => void; onCreate: () => void; onJoin: (event: React.FormEvent) => void; onJoinRoom: (room: UndercoverRoomState) => void; onRefresh: () => void; createDifficulty: UndercoverDifficulty; onDifficulty: (value: UndercoverDifficulty) => void }) {
  return <section className="space-y-5"><div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"><section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7"><h2 className=" text-2xl font-black text-brand-950">开一间房，找出那一个不一样的人。</h2><p className="mt-3 max-w-xl text-sm font-bold leading-7 text-slate-500">平民拿到相同词语，卧底拿到相近但不同的词语。描述不能直接说词，所有身份、词语与胜负都由服务端保护和判定。</p><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onCreate} disabled={busy} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">创建房间</button><button type="button" onClick={onRefresh} className="border border-sky-200 px-5 py-3 text-sm font-black text-brand-700">刷新公开房</button></div><label className="mt-5 block text-xs font-black text-slate-500">游戏难度<select value={createDifficulty} onChange={(event) => onDifficulty(event.target.value as UndercoverDifficulty)} className="mt-2 block w-full border border-sky-100 px-3 py-3 text-sm font-bold"><option value="EASY">简单</option><option value="NORMAL">普通</option><option value="HARD">困难</option></select></label><label className="mt-5 block text-xs font-black text-slate-500">房间密码（留空为公开房）<input value={createPassword} onChange={(event) => onCreatePassword(event.target.value)} maxLength={32} className="mt-2 block w-full border border-sky-100 px-3 py-3 text-sm font-bold outline-none focus:border-brand-400" placeholder="留空为公开房" /></label></section><section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7"><h2 className="text-xl font-black text-brand-950">加入房间</h2><p className="mt-2 text-sm font-bold text-slate-500">公开房可直接加入，密码房需要房间号与密码。</p><form onSubmit={onJoin} className="mt-5 space-y-3"><input required value={roomCode} onChange={(event) => onRoomCode(event.target.value)} inputMode="numeric" maxLength={6} className="block w-full border border-sky-100 px-3 py-3 text-sm font-bold" placeholder="6 位房间号" /><input value={password} onChange={(event) => onPassword(event.target.value)} type="password" maxLength={32} className="block w-full border border-sky-100 px-3 py-3 text-sm font-bold" placeholder="密码房请输入密码" /><button disabled={busy} className="w-full bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">加入房间</button></form></section></div><section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-black text-brand-950">卧底巨星档案</h2><p className="mt-2 text-sm font-bold text-slate-500">参与场次、胜负与成长等级。</p></div>{stats ? <span className="rounded bg-brand-950 px-3 py-2 text-sm font-black text-white">Lv.{stats.level} · {stats.xp} XP</span> : null}</div>{stats ? <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">参与场次</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.totalGames}</strong></div><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">胜利场次</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.totalWins}</strong></div><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">失败场次</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.totalLosses}</strong></div><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">胜率</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.winRate}%</strong></div></div> : <p className="mt-6 text-sm font-bold text-slate-500">还没有战绩，开一局试试吧。</p>}</section><section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">个人统计</h2><span className="text-xs font-bold text-slate-500">不含挂号费奖励</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><span className="text-xs font-bold text-slate-500">游戏次数</span><strong className="mt-1 block text-xl font-black text-brand-950">{stats?.totalGames || 0}</strong></div><div><span className="text-xs font-bold text-slate-500">胜场 / 胜率</span><strong className="mt-1 block text-xl font-black text-brand-950">{stats?.totalWins || 0} / {stats?.winRate || 0}%</strong></div><div><span className="text-xs font-bold text-slate-500">平民胜场</span><strong className="mt-1 block text-xl font-black text-brand-950">{stats?.civilianWins || 0}</strong></div><div><span className="text-xs font-bold text-slate-500">卧底胜场</span><strong className="mt-1 block text-xl font-black text-brand-950">{stats?.undercoverWins || 0}</strong></div></div></section><section><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black text-brand-950">公开房间</h2><span className="text-xs font-bold text-slate-500">仅显示等待中的公开房</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rooms.map((item) => <button type="button" key={item.roomId} onClick={() => onJoinRoom(item)} className="flex items-center gap-3 border border-sky-100 bg-white p-4 text-left shadow-sm transition hover:border-brand-400"><Avatar user={item.players[0] || { name: '房主', avatarUrl: null }} small /><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-black text-brand-950">{item.players[0]?.name || '房主'} 的房间</strong><small className="mt-1 block text-xs font-bold text-slate-500">{item.currentCount} / {item.maxPlayers} 人 · 房间 {item.roomCode}</small></span><span className="text-xs font-black text-brand-700">加入</span></button>)}{!rooms.length ? <p className="border border-dashed border-sky-200 p-6 text-sm font-bold text-slate-500 sm:col-span-2 lg:col-span-3">暂时没有公开等待房，创建一间吧。</p> : null}</div></section></section>
}

function Room({ room, busy, onReady, onStart, onLeave, onKick, onDifficulty }: { room: UndercoverRoomState; busy: boolean; onReady: (ready: boolean) => void; onStart: () => void; onLeave: () => void; onKick: (targetUserId: string) => void; onDifficulty: (value: UndercoverDifficulty) => void }) {
  const allReady = room.players.length >= 3 && room.players.every((player) => player.isReady)
  const me = room.players.find((player) => player.userId === room.viewerUserId)
  const isHost = Boolean(me?.isHost)
  const [difficulty, setDifficulty] = useState<UndercoverDifficulty>(room.difficulty)
  useEffect(() => { setDifficulty(room.difficulty) }, [room.difficulty])
  async function changeDifficulty(value: UndercoverDifficulty) { if (busy || value === difficulty) return; setDifficulty(value); try { await onDifficulty(value) } catch { setDifficulty(room.difficulty) } }
  return <section className="space-y-5"><div className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className=" text-2xl font-black text-brand-950">房间 {room.roomCode}</h2><p className="mt-2 text-sm font-bold text-slate-500">{room.hasPassword ? '私密房间' : '公开房间'} · {room.currentCount} / {room.maxPlayers} 人 · 难度 {undercoverDifficultyLabels[difficulty]}</p></div><div className="text-right text-xs font-bold text-slate-500">{room.players.length < 3 ? '至少需要 3 名玩家才能开始。' : allReady ? '所有玩家已准备。' : '等待所有玩家准备。'}</div></div><div className="mt-7 grid grid-cols-2 gap-3">{room.players.map((player) => <div key={player.playerId} className={`border p-4 text-center sm:p-6 ${player.isHost ? 'bg-sky-50/40' : 'border-sky-100'}`}><div className="mx-auto flex justify-center"><Avatar user={player} /></div><strong className="mt-3 block truncate text-sm font-black text-brand-950">{player.name}</strong><small className="mt-1 block text-xs font-bold text-slate-400">Lv.{player.level}</small><small className={`mt-1 block text-xs font-black ${player.isHost ? 'text-brand-700' : player.isReady ? 'text-emerald-700' : 'text-slate-400'}`}>{player.isHost ? '房主' : player.isReady ? '已准备' : '未准备'}</small>{isHost && !player.isHost ? <button type="button" disabled={busy} onClick={() => onKick(player.userId)} className="mt-3 border border-red-200 px-3 py-2 text-xs font-black text-red-700">踢出</button> : null}</div>)}{Array.from({ length: Math.max(0, 4 - room.players.length) }).map((_, index) => <div key={`empty-${index}`} className="border border-dashed border-sky-200 p-4 text-center text-sm font-bold text-slate-400 sm:p-6">等待玩家加入</div>)}</div><div className="mt-6 border border-sky-100 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-black text-slate-500">房间难度</span>{isHost ? <select value={difficulty} disabled={busy} onChange={(event) => void changeDifficulty(event.target.value as UndercoverDifficulty)} className="border border-sky-100 px-3 py-2 text-sm font-bold">{['EASY','NORMAL','HARD'].map((value) => <option key={value} value={value}>{undercoverDifficultyLabels[value as UndercoverDifficulty]}</option>)}</select> : <span className="text-sm font-bold text-slate-700">{undercoverDifficultyLabels[difficulty]}</span>}</div></div><div className="mt-6 flex flex-wrap gap-3"><button type="button" disabled={busy || !me} onClick={() => onReady(!(me?.isReady || false))} className="bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{me?.isReady ? '取消准备' : '准备'}</button>{isHost ? <button type="button" disabled={busy || !allReady} onClick={onStart} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">开始游戏</button> : null}<button type="button" disabled={busy} onClick={onLeave} className="border border-red-200 px-5 py-3 text-sm font-black text-red-700">退出房间</button></div></div><p className="border-l-2 border-amber-400 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">房主退出后，等待房会立即关闭；对局开始后可以通过刷新页面恢复观看。</p></section>
}

function Match({ snapshot, privateState, currentRoundDescriptions, currentSpeaker, voteOptions, countdown, showPrivate, description, guess, voteTarget, voteAbstain, busy, onShowPrivate, onDescription, onGuess, onVoteTarget, onVoteAbstain, onConfirmRole, onDescriptionSubmit, onVoteSubmit, onGuessSubmit, onBack }: { snapshot: UndercoverPublicMatchSnapshot; privateState: UndercoverPrivateState; currentRoundDescriptions: UndercoverPublicMatchSnapshot['descriptions']; currentSpeaker?: UndercoverPublicMatchSnapshot['players'][number]; voteOptions: UndercoverPublicMatchSnapshot['players']; countdown: number | null; showPrivate: boolean; description: string; guess: string; voteTarget: string | null; voteAbstain: boolean; busy: boolean; onShowPrivate: (value: boolean) => void; onDescription: (value: string) => void; onGuess: (value: string) => void; onVoteTarget: (value: string | null) => void; onVoteAbstain: (value: boolean) => void; onConfirmRole: () => void; onDescriptionSubmit: () => void; onVoteSubmit: () => void; onGuessSubmit: () => void; onBack: () => void }) {
  const isFinished = snapshot.status === 'FINISHED' || snapshot.phase === 'FINISHED'
  useEffect(() => {
    if (privateState.roleConfirmed) onShowPrivate(false)
  }, [onShowPrivate, privateState.roleConfirmed])
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 border border-sky-100 bg-white px-5 py-4 shadow-sm"><div><p className="text-xs font-black tracking-[0.16em] text-brand-700">第 {snapshot.round} 轮 · {phaseTitle(snapshot.phase)}</p><h2 className="mt-1 text-xl font-black text-brand-950">卧底巨星</h2></div><div className="flex items-center gap-3"><span className="text-sm font-black text-brand-700">{countdown === null ? '—' : `${countdown}s`}</span><button type="button" onClick={() => onShowPrivate(!showPrivate)} className="border border-sky-200 px-3 py-2 text-xs font-black text-brand-700">{showPrivate ? '隐藏我的词' : '查看我的词'}</button></div></div>{(snapshot.phase === 'ROLE_REVEAL' || showPrivate) && !isFinished ? <section className="mx-auto max-w-md border border-sky-100 bg-white p-6 text-center shadow-sm sm:p-10"><p className="text-xs font-black tracking-[0.16em] text-slate-500">你的词</p>{showPrivate ? <><p className="mt-4 text-4xl font-black text-brand-950">{privateState.word}</p></> : <p className="mt-8 text-2xl font-black text-slate-400">词已隐藏</p>}<button type="button" disabled={busy || (snapshot.phase === 'ROLE_REVEAL' && privateState.roleConfirmed)} onClick={snapshot.phase === 'ROLE_REVEAL' ? onConfirmRole : () => onShowPrivate(false)} className="mt-8 w-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{snapshot.phase === 'ROLE_REVEAL' ? (privateState.roleConfirmed ? '已确认，等待其他玩家' : '我知道了') : '关闭私密信息'}</button></section> : null}{!isFinished && snapshot.phase !== 'ROLE_REVEAL' ? <><section className="border border-sky-100 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-black text-brand-950">玩家状态</h3><span className="text-xs font-bold text-slate-500">已投票 {snapshot.voteProgress.submitted} / {snapshot.voteProgress.total}</span></div><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{snapshot.players.map((player) => <div key={player.playerId} className={`border p-3 ${player.playerId === snapshot.currentSpeakerId ? 'border-amber-400 bg-amber-50' : 'border-sky-100'} ${!player.isAlive ? 'opacity-45' : ''}`}><div className="flex items-center gap-2"><Avatar user={player} small /><span className="min-w-0 truncate text-sm font-black text-brand-950">{player.name}</span></div><small className="mt-2 block text-xs font-bold text-slate-500">{!player.isAlive ? '已淘汰' : player.playerId === snapshot.currentSpeakerId ? '正在描述' : '存活'}</small></div>)}</div></section>{snapshot.phase === 'DESCRIBING' ? <section className="border border-sky-100 bg-white p-5 shadow-sm"><h3 className="text-lg font-black text-brand-950">轮到谁描述？</h3><p className="mt-2 text-sm font-bold text-slate-500">{currentSpeaker ? `当前：${currentSpeaker.name}` : '等待服务端推进。'} · 不能直接说出自己的词语。</p><div className="mt-5 space-y-3">{currentRoundDescriptions.map((item) => <div key={`${item.round}-${item.playerId}`} className="border-l-2 border-sky-300 bg-sky-50/50 p-3"><strong className="text-xs font-black text-brand-700">{item.name}</strong><p className="mt-1 break-words text-sm font-bold text-brand-950">{item.content}</p></div>)}</div>{privateState.canDescribe ? <div className="mt-5"><textarea value={description} onChange={(event) => onDescription(event.target.value)} maxLength={30} rows={3} className="block w-full resize-none border border-sky-100 p-3 text-sm font-bold outline-none focus:border-brand-400" placeholder="用一句话描述你的词（最多 30 字）" /><div className="mt-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-400">{description.length} / 30</span><button type="button" disabled={busy || !description.trim()} onClick={onDescriptionSubmit} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40">提交描述</button></div></div> : <p className="mt-5 bg-slate-50 p-3 text-sm font-bold text-slate-500">等待其他玩家描述，提交后不能修改。</p>}</section> : null}{snapshot.phase === 'VOTING' || snapshot.phase === 'TIE_VOTING' ? <section className="border border-sky-100 bg-white p-5 shadow-sm"><h3 className="text-lg font-black text-brand-950">{snapshot.phase === 'TIE_VOTING' ? '平票加赛：选出一人' : '谁最可疑？'}</h3><p className="mt-2 text-sm font-bold text-slate-500">所有人投完前不会显示票数与投票对象。</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{voteOptions.map((player) => <button type="button" key={player.playerId} disabled={privateState.voteSubmitted || !privateState.canVote} onClick={() => { onVoteTarget(player.playerId); onVoteAbstain(false) }} className={`flex items-center gap-3 border p-3 text-left ${voteTarget === player.playerId ? 'border-brand-600 bg-sky-50' : 'border-sky-100'} disabled:cursor-not-allowed disabled:opacity-60`}><Avatar user={player} small /><span className="min-w-0 flex-1 truncate text-sm font-black text-brand-950">{player.name}</span>{voteTarget === player.playerId ? <span className="text-xs font-black text-brand-700">已选</span> : null}</button>)}</div><button type="button" disabled={privateState.voteSubmitted || !privateState.canVote} onClick={() => { onVoteAbstain(true); onVoteTarget(null) }} className={`mt-3 flex w-full items-center justify-center gap-2 border p-3 text-sm font-black ${voteAbstain ? 'border-brand-600 bg-sky-50 text-brand-700' : 'border-sky-100 text-slate-700'} disabled:cursor-not-allowed disabled:opacity-60`}>弃权（本轮不投任何人）</button>{privateState.canVote && !privateState.voteSubmitted ? <button type="button" disabled={busy || (!voteTarget && !voteAbstain)} onClick={onVoteSubmit} className="mt-5 bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40">确认提交</button> : <p className="mt-5 bg-slate-50 p-3 text-sm font-bold text-slate-500">{voteAbstain ? '你已选择弃票，等待其他玩家。' : '已投票，等待其他玩家。'}</p>}</section> : null}{snapshot.phase === 'UNDERCOVER_GUESS' ? <section className="border border-red-200 bg-red-50 p-5 shadow-sm"><h3 className="text-lg font-black text-red-900">你被发现了</h3>{privateState.canGuess ? <><p className="mt-2 text-sm font-bold leading-6 text-red-800">现在只有一次机会猜出平民的词。猜中即可翻盘。</p><input value={guess} onChange={(event) => onGuess(event.target.value)} maxLength={80} className="mt-5 block w-full border border-red-200 bg-white p-3 text-sm font-bold" placeholder="输入你认为的平民词" /><button type="button" disabled={busy || !guess.trim()} onClick={onGuessSubmit} className="mt-4 bg-red-800 px-5 py-3 text-sm font-black text-white disabled:opacity-40">提交猜词</button></> : <p className="mt-2 text-sm font-bold text-red-800">卧底正在进行最后猜词，其他玩家请等待结果。</p>}</section> : null}</> : null}<SpeechHistory history={snapshot.descriptionHistory} currentRound={snapshot.round} />{isFinished && snapshot.finalResult ? <Finished snapshot={snapshot} onBack={onBack} /> : null}</section>
}

function SpeechHistory({ history, currentRound }: { history: UndercoverDescriptionByRound[]; currentRound: number }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  if (!history.length) return null
  return <section className="border border-sky-100 bg-white p-5 shadow-sm"><h3 className="text-lg font-black text-brand-950">发言历史</h3><div className="mt-3 space-y-3">{history.map((entry) => {
    const isCurrent = entry.round === currentRound
    const isOpen = open[entry.round] ?? isCurrent
    return <div key={entry.round} className="border border-sky-100"><button type="button" onClick={() => setOpen((prev) => ({ ...prev, [entry.round]: !isOpen }))} className="flex w-full items-center justify-between px-3 py-2 text-left"><span className="text-sm font-black text-brand-700">第 {entry.round} 轮{isCurrent ? '（当前）' : ''}</span><span className="text-xs font-bold text-slate-400">{isOpen ? '收起 ▲' : '展开 ▼'}</span></button>{isOpen ? <div className="space-y-2 border-t border-sky-50 px-3 py-2">{entry.descriptions.length === 0 ? <p className="text-xs font-bold text-slate-400">暂无发言</p> : entry.descriptions.map((item) => <div key={`${item.round}-${item.playerId}`} className="border-l-2 border-sky-300 bg-sky-50/50 p-2"><strong className="text-xs font-black text-brand-700">{item.name}</strong><p className="mt-1 break-words text-sm font-bold text-brand-950">{item.content}</p></div>)}</div> : null}</div>
  })}</div></section>
}

function Finished({ snapshot, onBack }: { snapshot: UndercoverPublicMatchSnapshot; onBack: () => void }) {
  const result = snapshot.finalResult
  if (!result) return null
  const nameById = new Map(snapshot.players.map((player) => [player.playerId, player.name]))
  return <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-7"><h2 className=" text-3xl font-black text-brand-950">{result.winner === 'UNDERCOVER' ? '卧底胜利' : '平民胜利'}</h2><p className="mt-2 text-sm font-bold text-slate-500">{result.reason === 'UNDERCOVER_GUESS_CORRECT' ? '卧底猜中了平民词，成功翻盘。' : result.reason === 'UNDERCOVER_SURVIVAL' ? '卧底存活到最后两人。' : result.reason === 'UNDERCOVER_GUESS_TIMEOUT' ? '卧底超时未能猜词。' : '卧底没有猜中平民词。'}</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="border border-sky-100 p-4"><span className="text-xs font-black text-slate-500">平民词</span><strong className="mt-2 block break-words text-xl font-black text-brand-950">{result.civilianWord}</strong></div><div className="border border-red-100 bg-red-50/50 p-4"><span className="text-xs font-black text-red-700">卧底词</span><strong className="mt-2 block break-words text-xl font-black text-red-900">{result.undercoverWord}</strong></div></div><div className="mt-5 space-y-2">{result.players.map((player) => <div key={player.playerId} className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-50 py-3"><span className="text-sm font-black text-brand-950">{nameById.get(player.playerId) || '玩家'}</span><span className={`text-xs font-black ${player.role === 'UNDERCOVER' ? 'text-red-700' : 'text-slate-600'}`}>{roleTitle(player.role)} · {player.isAlive ? '存活到最后' : '已淘汰'} · 获得 {player.totalVotesReceived} 票</span></div>)}</div><div className="mt-6"><button type="button" onClick={onBack} className="bg-brand-950 px-5 py-3 text-sm font-black text-white">返回大厅</button></div></section>
}
