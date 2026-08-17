import type {
  UndercoverDifficulty,
  UndercoverMatchPhase,
  UndercoverMatchStatus,
  UndercoverRole,
  UndercoverRoomStatus,
  UndercoverVoteStage,
  UndercoverWinnerSide,
} from '@prisma/client'

export type UndercoverPublicUser = {
  userId: string
  uid: number
  name: string
  avatarUrl: string | null
  /** 卧底巨星成长等级（由累计 XP 推导，默认 1）。 */
  level: number
}

export type UndercoverRoomPlayerPublic = UndercoverPublicUser & {
  playerId: string
  isHost: boolean
  isReady: boolean
  isOnline: boolean
}

export type UndercoverPresence = {
  /** 好友当前参与的卧底巨星状态。WAITING=房间中（可跟随进入）；PLAYING=游戏中（仅展示）。 */
  status: 'WAITING' | 'PLAYING'
  roomId: string
  /** 公开房间码，用于复用现有加入 API 跟随进入；本身是可分享的非敏感信息。 */
  roomCode: string
  /** 仅 WAITING 且房间未满、无进行中对局时为 true。PLAYING 恒为 false。 */
  canJoin: boolean
  /** 房间是否设有密码（好友关系不绕过密码）。 */
  requiresPassword: boolean
}

export type UndercoverRoomState = {
  roomId: string
  roomCode: string
  viewerUserId: string | null
  status: UndercoverRoomStatus
  isPublic: boolean
  hasPassword: boolean
  hostId: string
  difficulty: UndercoverDifficulty
  currentCount: number
  maxPlayers: 4
  players: UndercoverRoomPlayerPublic[]
  matchId: string | null
  lastActivityAt: string
}

export type UndercoverRoomMessagePublic = {
  id: string
  roomId: string
  userId: string
  name: string
  avatarUrl: string | null
  content: string
  createdAt: string
}

export type UndercoverFriendPresence = {
  friendUserId: string
  name: string
  avatarUrl: string | null
  inRoom: boolean
  roomId: string | null
  matchActive: boolean
  difficulty: UndercoverDifficulty | null
}

export type UndercoverActiveState = {
  activeRoom: UndercoverRoomState | null
  activeMatch: { matchId: string; roomId: string; status: UndercoverMatchStatus } | null
  isInActiveGame: boolean
}

export type UndercoverMatchPlayerPublic = UndercoverPublicUser & {
  playerId: string
  isHost: boolean
  isAlive: boolean
  roleConfirmed: boolean
  isOnline: boolean
  eliminatedAt: string | null
  role?: UndercoverRole
  word?: string
}

export type UndercoverDescriptionPublic = {
  playerId: string
  userId: string
  name: string
  round: number
  content: string
  isAuto: boolean
}

/** 单轮发言分组，用于发言历史（含当前轮）。 */
export type UndercoverDescriptionByRound = {
  round: number
  descriptions: UndercoverDescriptionPublic[]
}

export type UndercoverRoundResult = {
  round: number
  kind: 'NO_ELIMINATION' | 'CIVILIAN_ELIMINATED' | 'UNDERCOVER_FOUND' | 'UNDERCOVER_GUESS'
  eliminatedPlayerId: string | null
  voteCounts: Array<{ playerId: string; count: number }>
  tieCandidates: string[]
  descriptions: UndercoverDescriptionPublic[]
}

export type UndercoverFinalPlayer = {
  playerId: string
  userId: string
  role: UndercoverRole
  word: string
  isAlive: boolean
  totalVotesReceived: number
}

export type UndercoverFinalResult = {
  winner: UndercoverWinnerSide
  reason: string
  civilianWord: string
  undercoverWord: string
  undercoverPlayerId: string
  players: UndercoverFinalPlayer[]
}

export type UndercoverPublicMatchSnapshot = {
  matchId: string
  roomId: string
  status: UndercoverMatchStatus
  phase: UndercoverMatchPhase
  round: number
  revision: number
  serverNow: string
  phaseDeadline: string | null
  currentSpeakerId: string | null
  players: UndercoverMatchPlayerPublic[]
  descriptions: UndercoverDescriptionPublic[]
  descriptionHistory: UndercoverDescriptionByRound[]
  voteProgress: { submitted: number; total: number; stage: UndercoverVoteStage | null; abstained: number }
  tieCandidates: string[]
  roundHistory: UndercoverRoundResult[]
  lastRoundResult: UndercoverRoundResult | null
  finalResult: UndercoverFinalResult | null
}

export type UndercoverPrivateState = {
  matchId: string
  playerId: string
  /**
   * 仅在对局结束后（FINISHED）才返回角色；对局进行中（PLAYING，含 ROLE_REVEAL / DESCRIPTION / VOTE / FINAL_GUESS 等任何阶段）出于安全考虑绝不返回角色。
   * 即使 UI 隐藏，若 PLAYING 的 privateState JSON 里包含 role，用户开 DevTools 即可作弊，因此必须彻底不返回。
   */
  role?: UndercoverRole
  word: string
  roleConfirmed: boolean
  isAlive: boolean
  phase: UndercoverMatchPhase
  round: number
  revision: number
  descriptionSubmitted: boolean
  voteSubmitted: boolean
  voteStage: UndercoverVoteStage | null
  voteTargetId: string | null
  guessSubmitted: boolean
  canDescribe: boolean
  canVote: boolean
  canGuess: boolean
  phaseDeadline: string | null
}

export type UndercoverRealtimeEvent =
  | { type: 'SERVER_HELLO'; serverNow: string }
  | { type: 'ROOM_STATE'; state: UndercoverRoomState }
  | { type: 'ROOM_CHAT_MESSAGE'; message: UndercoverRoomMessagePublic }
  | { type: 'ROOM_KICKED'; roomId: string }
  | { type: 'ROOM_DISSOLVED'; roomId: string }
  | { type: 'MATCH_STATE'; state: UndercoverPublicMatchSnapshot }
  | { type: 'PONG'; serverNow: string }
  | { type: 'ERROR'; code: string; message: string }

export type UndercoverClientCommand =
  | { type: 'JOIN_ROOM'; roomId: string }
  | { type: 'JOIN_MATCH'; matchId: string }
  | { type: 'SYNC_ROOM'; roomId: string }
  | { type: 'SYNC_MATCH'; matchId: string }
  | { type: 'PING' }
