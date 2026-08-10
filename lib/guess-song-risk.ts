import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { toPublicGuessSongMode } from '@/lib/guess-song-config'
import { prisma } from '@/lib/prisma'

export const GUESS_SONG_RISK_THRESHOLD = 80
export const GUESS_SONG_CHEAT_EXIT_SECONDS = 10

const RISK_WINDOW_MS = 60_000
const QUICK_ANSWER_LIMIT_MS = 2_000
const QUICK_ANSWER_COUNT = 10

export type GuessSongRiskReason = {
  code: string
  label: string
  points: number
  detectedAt: string
}

export type GuessSongRiskAssessment = {
  riskScore: number
  reasons: GuessSongRiskReason[]
  cheatDetected: boolean
  exitAfterSeconds?: number
}

export type RiskTrigger = 'SESSION' | 'PLAY' | 'ANSWER'

type RiskAssessmentInput = {
  userId: string
  sessionId: string
  trigger: RiskTrigger
  clientSessionToken?: string | null
  clientFlowComplete?: boolean
  questionAttemptTokenValid?: boolean
  now?: Date
}

type SessionSecurityFields = {
  id: string
  userId: string
  clientSessionNonce: string | null
  clientSessionTokenIssuedAt: Date | null
}

type RiskReasonDefinition = Omit<GuessSongRiskReason, 'detectedAt'>

const reasonDefinitions: Record<string, RiskReasonDefinition> = {
  CLIENT_FLOW_MISSING: {
    code: 'CLIENT_FLOW_MISSING',
    label: '缺少浏览器初始化流程',
    points: 40,
  },
  CLIENT_SESSION_TOKEN_INVALID: {
    code: 'CLIENT_SESSION_TOKEN_INVALID',
    label: '缺少或无效 clientSessionToken',
    points: 40,
  },
  API_ACTIVITY_SPIKE: {
    code: 'API_ACTIVITY_SPIKE',
    label: '高频 sessions / answer / play 请求',
    points: 30,
  },
  BULK_AUDIO_ACCESS: {
    code: 'BULK_AUDIO_ACCESS',
    label: '短时间批量获取音频签名地址',
    points: 30,
  },
  QUICK_ANSWERS: {
    code: 'QUICK_ANSWERS',
    label: '连续 10 题平均答题时间低于 2 秒',
    points: 40,
  },
  PERFECT_FAST_API: {
    code: 'PERFECT_FAST_API',
    label: '100% 正确、极短答题且 API 行为异常',
    points: 20,
  },
  QUESTION_ATTEMPT_TOKEN_INVALID: {
    code: 'QUESTION_ATTEMPT_TOKEN_INVALID',
    label: 'questionAttemptToken 缺失、过期或重复使用',
    points: 40,
  },
}

function riskSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-before-production'
}

function encodePayload(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signPayload(payload: string) {
  return createHmac('sha256', `${riskSecret()}:guess-song-risk`).update(payload).digest('base64url')
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function sameTokenHash(value: string, expectedHash: string | null | undefined) {
  if (!expectedHash) return false
  const actual = Buffer.from(hashToken(value), 'utf8')
  const expected = Buffer.from(expectedHash, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function parseRiskReasons(value: Prisma.JsonValue | null | undefined): GuessSongRiskReason[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return typeof row.code === 'string'
      && typeof row.label === 'string'
      && typeof row.points === 'number'
      && typeof row.detectedAt === 'string'
      ? [{ code: row.code, label: row.label, points: row.points, detectedAt: row.detectedAt }]
      : []
  })
}

function makeReason(code: keyof typeof reasonDefinitions, now: Date): GuessSongRiskReason {
  return { ...reasonDefinitions[code], detectedAt: now.toISOString() }
}

export function normalizeClientFlowNonce(value: unknown) {
  if (typeof value !== 'string') return null
  const nonce = value.trim()
  return /^[a-zA-Z0-9_-]{16,128}$/.test(nonce) ? nonce : null
}

export function createClientSessionNonce() {
  return randomBytes(18).toString('base64url')
}

export function issueClientSessionToken(input: {
  sessionId: string
  userId: string
  nonce: string
  issuedAt: Date
}) {
  const payload = encodePayload({
    sessionId: input.sessionId,
    userId: input.userId,
    timestamp: input.issuedAt.getTime(),
    nonce: input.nonce,
  })
  return `${payload}.${signPayload(payload)}`
}

export function issueQuestionAttemptToken(seed?: string) {
  const token = seed
    ? createHmac('sha256', `${riskSecret()}:guess-song-question-attempt`).update(seed).digest('base64url')
    : randomBytes(24).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function isQuestionAttemptTokenValid(token: string | null | undefined, expectedHash: string | null | undefined) {
  return Boolean(token && sameTokenHash(token, expectedHash))
}

export function isClientSessionTokenValid(
  token: string | null | undefined,
  session: SessionSecurityFields,
) {
  if (!token || !session.clientSessionNonce || !session.clientSessionTokenIssuedAt) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, signature] = parts
  if (signPayload(payload) !== signature) return false
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    return parsed.sessionId === session.id
      && parsed.userId === session.userId
      && parsed.nonce === session.clientSessionNonce
      && parsed.timestamp === session.clientSessionTokenIssuedAt.getTime()
  } catch {
    return false
  }
}

export async function ensureClientSessionCredentials(
  session: SessionSecurityFields,
  preferredNonce?: string | null,
  now = new Date(),
) {
  const nonce = session.clientSessionNonce || normalizeClientFlowNonce(preferredNonce) || createClientSessionNonce()
  const issuedAt = session.clientSessionTokenIssuedAt || now
  if (session.clientSessionNonce !== nonce || !session.clientSessionTokenIssuedAt) {
    await prisma.guessSongSession.update({
      where: { id: session.id },
      data: { clientSessionNonce: nonce, clientSessionTokenIssuedAt: issuedAt },
    })
  }
  return {
    nonce,
    issuedAt,
    clientSessionToken: issueClientSessionToken({
      sessionId: session.id,
      userId: session.userId,
      nonce,
      issuedAt,
    }),
  }
}

async function countRateLimitEvents(key: string, action: string, since: Date) {
  return prisma.rateLimitLog.count({
    where: { key, action, createdAt: { gte: since } },
  }).catch(() => 0)
}

async function getRecentAudioAccess(userId: string, since: Date) {
  const rows = await prisma.guessSongPlayRequest.findMany({
    where: {
      createdAt: { gte: since },
      GuessSongSessionQuestion: { GuessSongSession: { userId } },
    },
    select: { audioVariantId: true },
    take: 101,
  }).catch(() => [])
  return { count: rows.length, distinctAudioCount: new Set(rows.map((row) => row.audioVariantId)).size }
}

async function getQuickAnswerSignal(sessionId: string) {
  const rows = await prisma.guessSongSessionQuestion.findMany({
    where: { sessionId, answeredAt: { not: null }, answerLatencyMs: { not: null } },
    orderBy: { position: 'desc' },
    select: { answerLatencyMs: true, isCorrect: true, selectedOptionKey: true },
    take: QUICK_ANSWER_COUNT,
  }).catch(() => [])
  if (rows.length < QUICK_ANSWER_COUNT) return { quick: false, perfect: false, averageMs: null, answerCount: rows.length }
  const latencies = rows.map((row) => row.answerLatencyMs || 0)
  const averageMs = latencies.reduce((sum, value) => sum + value, 0) / latencies.length
  return {
    quick: averageMs < QUICK_ANSWER_LIMIT_MS,
    perfect: rows.every((row) => row.isCorrect === true),
    averageMs,
    answerCount: rows.length,
  }
}

function reasonJson(reasons: GuessSongRiskReason[]) {
  return reasons as unknown as Prisma.InputJsonValue
}

export type GuessSongRiskSignals = {
  trigger: RiskTrigger
  clientFlowComplete?: boolean
  clientSessionTokenValid?: boolean
  questionAttemptTokenValid?: boolean
  sessionCreateCount: number
  answerRequestCount: number
  playRequestCount: number
  audioAccessCount: number
  distinctAudioCount: number
  answeredQuestionCount: number
  averageAnswerMs: number | null
  perfect: boolean
  previousReasons?: GuessSongRiskReason[]
  now?: Date
}

export function calculateGuessSongRisk(input: GuessSongRiskSignals) {
  const now = input.now ?? new Date()
  const apiActivitySpike = input.sessionCreateCount >= 3
    || input.answerRequestCount >= 20
    || input.playRequestCount >= 30
  const quickAnswers = input.answeredQuestionCount >= QUICK_ANSWER_COUNT
    && input.averageAnswerMs !== null
    && input.averageAnswerMs < QUICK_ANSWER_LIMIT_MS
  const previousReasons = input.previousReasons ?? []
  const previousCodes = new Set(previousReasons.map((reason) => reason.code))
  const candidates: GuessSongRiskReason[] = []

  if (input.trigger === 'SESSION' && input.clientFlowComplete === false) {
    candidates.push(makeReason('CLIENT_FLOW_MISSING', now))
  }
  if ((input.trigger === 'PLAY' || input.trigger === 'ANSWER') && input.clientSessionTokenValid === false) {
    candidates.push(makeReason('CLIENT_SESSION_TOKEN_INVALID', now))
  }
  if (apiActivitySpike) candidates.push(makeReason('API_ACTIVITY_SPIKE', now))
  if (input.audioAccessCount >= 15 || input.distinctAudioCount >= 10) {
    candidates.push(makeReason('BULK_AUDIO_ACCESS', now))
  }
  if (quickAnswers) candidates.push(makeReason('QUICK_ANSWERS', now))
  if (quickAnswers && input.perfect && apiActivitySpike) {
    candidates.push(makeReason('PERFECT_FAST_API', now))
  }
  if (input.questionAttemptTokenValid === false) {
    candidates.push(makeReason('QUESTION_ATTEMPT_TOKEN_INVALID', now))
  }

  const newReasons = candidates.filter((reason, index) =>
    !previousCodes.has(reason.code) && candidates.findIndex((item) => item.code === reason.code) === index)
  const reasons = [...previousReasons, ...newReasons]
  return {
    riskScore: Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0)),
    reasons,
    apiActivitySpike,
    quickAnswers,
  }
}

export class GuessSongRiskService {
  static async assess(input: RiskAssessmentInput): Promise<GuessSongRiskAssessment> {
    const now = input.now ?? new Date()
    try {
      const session = await prisma.guessSongSession.findUnique({
        where: { id: input.sessionId },
        select: {
          id: true,
          userId: true,
          mode: true,
          score: true,
          status: true,
          isValid: true,
          riskScore: true,
          riskReasons: true,
          clientSessionNonce: true,
          clientSessionTokenIssuedAt: true,
        },
      })
      if (!session || session.userId !== input.userId) {
        return { riskScore: 0, reasons: [], cheatDetected: false }
      }

      const since = new Date(now.getTime() - RISK_WINDOW_MS)
      const [sessionCreateCount, answerRequestCount, playRequestCount, audioAccess, quickSignal] = await Promise.all([
        countRateLimitEvents(input.userId, 'guess-song-session-create', since),
        countRateLimitEvents(input.userId, 'guess-song-answer', since),
        countRateLimitEvents(input.userId, 'guess-song-play', since),
        getRecentAudioAccess(input.userId, since),
        getQuickAnswerSignal(input.sessionId),
      ])

      const previousReasons = parseRiskReasons(session.riskReasons)
      const calculated = calculateGuessSongRisk({
        trigger: input.trigger,
        clientFlowComplete: input.clientFlowComplete,
        clientSessionTokenValid: isClientSessionTokenValid(input.clientSessionToken, session),
        questionAttemptTokenValid: input.questionAttemptTokenValid,
        sessionCreateCount,
        answerRequestCount,
        playRequestCount,
        audioAccessCount: audioAccess.count,
        distinctAudioCount: audioAccess.distinctAudioCount,
        answeredQuestionCount: quickSignal.answerCount,
        averageAnswerMs: quickSignal.averageMs,
        perfect: quickSignal.perfect,
        previousReasons,
        now,
      })
      const { reasons, riskScore } = calculated
      const newReasons = reasons.filter((reason) => !previousReasons.some((previous) => previous.code === reason.code))
      const alreadyCheated = session.status === 'CHEAT_DETECTED' || !session.isValid
      const cheatDetected = alreadyCheated || riskScore >= GUESS_SONG_RISK_THRESHOLD

      if (newReasons.length > 0 || (cheatDetected && !alreadyCheated)) {
        await prisma.guessSongRiskLog.create({
          data: {
            mode: session.mode,
            score: session.score,
            riskScore,
            trigger: input.trigger,
            reasons: reasonJson(reasons),
            userId: session.userId,
            sessionId: session.id,
          },
        })
        await prisma.guessSongSession.update({
          where: { id: session.id },
          data: {
            riskScore,
            riskReasons: reasonJson(reasons),
            ...(cheatDetected && !alreadyCheated
              ? {
                  status: 'CHEAT_DETECTED',
                  score: 0,
                  isValid: false,
                  invalidatedAt: now,
                  activeKey: null,
                  completedAt: session.status === 'COMPLETED' ? undefined : now,
                }
              : {}),
          },
        })
      }

      return {
        riskScore,
        reasons,
        cheatDetected,
        ...(cheatDetected ? { exitAfterSeconds: GUESS_SONG_CHEAT_EXIT_SECONDS } : {}),
      }
    } catch (error) {
      console.error('[guess-song-risk.assess]', error)
      return { riskScore: 0, reasons: [], cheatDetected: false }
    }
  }

  static async listLogs(input: { limit?: number; minRiskScore?: number } = {}) {
    const limit = Math.min(100, Math.max(1, input.limit || 50))
    const rows = await prisma.guessSongRiskLog.findMany({
      where: input.minRiskScore ? { riskScore: { gte: input.minRiskScore } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        User: { select: { id: true, uid: true, nickname: true, username: true } },
      },
    })
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      uid: row.User.uid,
      nickname: row.User.nickname,
      username: row.User.username,
      mode: toPublicGuessSongMode(row.mode),
      score: row.score,
      riskScore: row.riskScore,
      trigger: row.trigger,
      reasons: parseRiskReasons(row.reasons),
      createdAt: row.createdAt.toISOString(),
    }))
  }
}
