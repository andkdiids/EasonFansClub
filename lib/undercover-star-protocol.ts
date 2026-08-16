import type {
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
}

export type UndercoverRoomPlayerPublic = UndercoverPublicUser & {
  playerId: string
  isHost: boolean
  isReady: boolean
  isOnline: boolean
}

export type UndercoverRoomState = {
  roomId: string
  roomCode: string
  viewerUserId: string | null
  status: UndercoverRoomStatus
  isPublic: boolean
  hasPassword: boolean
  hostId: string
  currentCount: number
  maxPlayers: 4
  players: UndercoverRoomPlayerPublic[]
  matchId: string | null
  lastActivityAt: string
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
  voteProgress: { submitted: number; total: number; stage: UndercoverVoteStage | null }
  tieCandidates: string[]
  roundHistory: UndercoverRoundResult[]
  lastRoundResult: UndercoverRoundResult | null
  finalResult: UndercoverFinalResult | null
}

export type UndercoverPrivateState = {
  matchId: string
  playerId: string
  role: UndercoverRole
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
  | { type: 'MATCH_STATE'; state: UndercoverPublicMatchSnapshot }
  | { type: 'PONG'; serverNow: string }
  | { type: 'ERROR'; code: string; message: string }

export type UndercoverClientCommand =
  | { type: 'JOIN_ROOM'; roomId: string }
  | { type: 'JOIN_MATCH'; matchId: string }
  | { type: 'SYNC_ROOM'; roomId: string }
  | { type: 'SYNC_MATCH'; matchId: string }
  | { type: 'PING' }
