export type DuelOption = { key: string; label: string }

export type DuelPublicUser = {
  id: string
  uid: number
  name: string
  avatarUrl: string | null
  isOnline: boolean
}

export type DuelRoomState = {
  id: string
  roomCode: string
  hasPassword: boolean
  isPublic: boolean
  status: 'WAITING' | 'READY' | 'PLAYING' | 'FINISHED' | 'CLOSED'
  hostReady: boolean
  challengerReady: boolean
  host: DuelPublicUser
  challenger: DuelPublicUser | null
  currentCount: number
  matchId: string | null
}

export type DuelPlayerState = DuelPublicUser & {
  userId: string
  slot: 1 | 2
  correctCount: number
  totalEffectiveAnswerMs: number
  submitted: boolean
  suspicious: boolean
}

export type DuelQuestionState = {
  id: string
  publicToken: string
  questionIndex: number
  options: DuelOption[]
  audioDurationSeconds: number
  serverStartedAt: string
  audioStartAt: string
  answerDeadlineAt: string
  audioUrl: string
  preloadAudioUrl: string | null
}

export type DuelQuestionResult = {
  questionIndex: number
  correctOptionKey: string
  correctLabel: string
  answers: Array<{
    userId: string
    selectedOptionKey: string | null
    correct: boolean
    effectiveElapsedMs: number | null
  }>
}

export type DuelMatchResult = {
  matchId: string
  status: 'FINISHED' | 'INVALID' | 'CLOSED'
  finishReason: string | null
  winnerId: string | null
  isDraw: boolean
  rewardAmount: number
  startedAt: string
  finishedAt: string | null
  players: Array<{
    userId: string
    slot: 1 | 2
    name: string
    avatarUrl: string | null
    correctCount: number
    accuracy: number
    totalEffectiveAnswerMs: number
    averageAnswerMs: number | null
  }>
}

export type DuelMatchState = {
  matchId: string
  roomId: string
  status: 'PLAYING' | 'FINISHED' | 'INVALID' | 'CLOSED'
  phase: 'STARTING' | 'PLAYING' | 'FINISHED' | 'INVALID' | 'CLOSED'
  currentQuestionIndex: number
  totalQuestions: number
  completedQuestionCount: number
  serverNow: string
  players: DuelPlayerState[]
  question: DuelQuestionState | null
  questionResult: DuelQuestionResult | null
  result: DuelMatchResult | null
}

export type DuelRealtimeEvent =
  | { type: 'SERVER_HELLO'; serverNow: string }
  | { type: 'TIME_SYNC'; requestId: string; clientSentAt: number; serverReceivedAt: number; serverSentAt: number }
  | { type: 'PONG'; serverNow: string }
  | { type: 'ROOM_STATE'; state: DuelRoomState }
  | { type: 'MATCH_STATE'; state: DuelMatchState }
  | { type: 'MATCH_STARTING'; matchId: string; serverStartAt: string; questionIndex: number; totalQuestions: number }
  | { type: 'QUESTION_START'; state: DuelQuestionState; players: DuelPlayerState[]; completedQuestionCount: number }
  | { type: 'PLAYER_ANSWERED'; matchId: string; questionIndex: number; userId: string }
  | { type: 'ANSWER_ACCEPTED'; matchId: string; questionIndex: number; userId: string }
  | { type: 'QUESTION_RESULT'; matchId: string; result: DuelQuestionResult; nextServerStartAt: string | null }
  | { type: 'PLAYER_PRESENCE'; matchId: string; userId: string; isOnline: boolean; reconnectDeadlineAt: string | null }
  | { type: 'MATCH_FINISHED'; result: DuelMatchResult }
  | { type: 'ERROR'; code: string; message: string }

export type DuelClientCommand =
  | { type: 'JOIN_ROOM'; roomId: string }
  | { type: 'JOIN_MATCH'; matchId: string }
  | { type: 'TIME_SYNC_REQUEST'; requestId: string; clientSentAt: number }
  | { type: 'TIME_SYNC_ACK'; requestId: string }
  | { type: 'PING' }
  | { type: 'ANSWER'; matchId: string; questionToken: string; selectedOptionKey: string; clientElapsedMs: number }
