import { randomUUID } from 'node:crypto'
import { Prisma, type WantListenFakeTitleDifficulty, type WantListenMode } from '@prisma/client'
import {
  assessWantListenLatencies,
  averageAnswerTime,
  computeServerElapsedMs,
  fastestAnswerTime,
  isSingleAnswerTooFast,
  recordAntiCheatLog,
} from '@/lib/anti-cheat'
import { syncUserAchievements } from '@/lib/achievements'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { normalizeRatingLanguage } from '@/lib/rating-types'
import { prisma } from '@/lib/prisma'
import { cleanLyrics, selectLyricFragment, selectSafeLyricSnippet } from '@/lib/want-listen-lyrics'
import {
  DEFAULT_WANT_LISTEN_CONFIG,
  WANT_LISTEN_EXPIRY_GRACE_MS,
  WANT_LISTEN_MODE_LABELS,
  WANT_LISTEN_MODES,
  WANT_LISTEN_MAX_WRONG_COUNT,
  WANT_LISTEN_MAX_HINTS,
  WANT_LISTEN_SESSION_TTL_MS,
  difficultyForQuestion,
  isWantListenMode,
  isWantListenModeEnabled,
  scoreForWantListenAnswer,
  type WantListenConfig,
} from '@/lib/want-listen-config'
import {
  buildCantoneseFragmentQuestion,
  buildFalseTitleQuestion,
  buildWantListenQuestion,
  effectiveSongLanguage,
  effectiveSongYear,
  isValidWantListenSong,
  shuffle,
  validateQuestion,
  type WantListenBuiltQuestion,
  type WantListenSongCandidate,
  type WantListenStoredQuestion,
} from '@/lib/want-listen-questions'
import { normalizeWantListenTitle } from '@/lib/want-listen-title'
import { recordWantListenLeaderboard } from '@/lib/want-listen-leaderboard'
import { settleOptionalWantListenRead } from '@/lib/want-listen-summary'

const WANT_LISTEN_SETTING_KEYS = {
  enabled: 'entertainment.want-listen.enabled',
  wantListenEnabled: 'entertainment.want-listen.mode.want-listen',
  cantoneseFragmentEnabled: 'entertainment.want-listen.mode.cantonese-fragment',
  falseTitleEnabled: 'entertainment.want-listen.mode.false-title',
} as const

export class WantListenServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'WANT_LISTEN_REQUEST_FAILED',
  ) {
    super(message)
    this.name = 'WantListenServiceError'
  }
}

type SessionWithQuestions = Prisma.WantListenSessionGetPayload<{
  include: { WantListenSessionQuestion: true }
}>

type SongRow = {
  id: string
  title: string
  artist: string
  releaseYear: number
  language: string | null
  lyricist: string | null
  composer: string | null
  arranger: string | null
  producer: string | null
  lyrics: string | null
  description: string | null
  story: string | null
  MusicAlbum: {
    id: string
    name: string
    releaseYear: number
    language: string
    coverUrl: string | null
  }
}

type PreparedQuestion = WantListenBuiltQuestion & { fakeTitleId?: string }

function boolSetting(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return value === 'true' || value === '1' || value === 'yes'
}

export async function getWantListenConfig(database: Pick<typeof prisma, 'siteSetting'> = prisma): Promise<WantListenConfig> {
  const rows = await database.siteSetting.findMany({ where: { key: { in: Object.values(WANT_LISTEN_SETTING_KEYS) } }, select: { key: true, value: true } })
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return {
    enabled: boolSetting(values.get(WANT_LISTEN_SETTING_KEYS.enabled), DEFAULT_WANT_LISTEN_CONFIG.enabled),
    wantListenEnabled: boolSetting(values.get(WANT_LISTEN_SETTING_KEYS.wantListenEnabled), DEFAULT_WANT_LISTEN_CONFIG.wantListenEnabled),
    cantoneseFragmentEnabled: boolSetting(values.get(WANT_LISTEN_SETTING_KEYS.cantoneseFragmentEnabled), DEFAULT_WANT_LISTEN_CONFIG.cantoneseFragmentEnabled),
    falseTitleEnabled: boolSetting(values.get(WANT_LISTEN_SETTING_KEYS.falseTitleEnabled), DEFAULT_WANT_LISTEN_CONFIG.falseTitleEnabled),
  }
}

export async function saveWantListenConfig(config: WantListenConfig, database: Pick<Prisma.TransactionClient, 'siteSetting'> | typeof prisma = prisma) {
  await Promise.all(Object.entries(WANT_LISTEN_SETTING_KEYS).map(([name, key]) => database.siteSetting.upsert({
    where: { key },
    update: { value: String(config[name as keyof WantListenConfig]), valueType: 'BOOLEAN', group: 'entertainment', label: `想听：${name}` },
    create: { key, value: String(config[name as keyof WantListenConfig]), valueType: 'BOOLEAN', group: 'entertainment', label: `想听：${name}` },
  })))
  return config
}

function isRetryableTransactionError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return code === 'P2034' || message.includes('deadlock') || message.includes('serialization')
}

async function transactionWithRetry<T>(callback: (database: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(callback)
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error
    }
  }
  throw new Error('transaction retry exhausted')
}

function mapSong(row: SongRow): WantListenSongCandidate {
  return {
    id: row.id,
    title: row.title,
    releaseYear: row.releaseYear,
    language: row.language,
    lyricist: row.lyricist,
    composer: row.composer,
    arranger: row.arranger,
    producer: row.producer,
    lyrics: row.lyrics,
    description: row.description,
    story: row.story,
    album: {
      id: row.MusicAlbum.id,
      name: row.MusicAlbum.name,
      releaseYear: row.MusicAlbum.releaseYear,
      language: row.MusicAlbum.language,
      coverUrl: row.MusicAlbum.coverUrl,
    },
  }
}

async function loadSongRows() {
  return prisma.musicSong.findMany({
    where: { title: { not: '' }, MusicAlbum: { status: 'PUBLISHED' } },
    select: {
      id: true,
      title: true,
      artist: true,
      releaseYear: true,
      language: true,
      lyricist: true,
      composer: true,
      arranger: true,
      producer: true,
      lyrics: true,
      description: true,
      story: true,
      MusicAlbum: { select: { id: true, name: true, releaseYear: true, language: true, coverUrl: true } },
    },
  })
}

async function loadSongPool(mode: WantListenMode) {
  const songs = (await loadSongRows()).map(mapSong)
  if (mode === 'WANT_LISTEN') return songs.filter(isValidWantListenSong)
  return songs.filter((song) => {
    const lines = cleanLyrics(song.lyrics)
    return normalizeRatingLanguage(effectiveSongLanguage(song)) === 'CANTONESE'
      && Boolean(selectLyricFragment(lines, 1))
  })
}

async function loadRealTitles() {
  const songs = (await loadSongRows()).map(mapSong)
  const seen = new Set<string>()
  return songs
    .map((song) => song.title.trim())
    .filter((title) => {
      const key = normalizeWantListenTitle(title)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function loadActiveFakeTitles(realTitles: readonly string[]) {
  const realKeys = new Set(realTitles.map(normalizeWantListenTitle).filter(Boolean))
  const rows = await prisma.wantListenFakeTitle.findMany({
    where: { enabled: true },
    orderBy: [{ difficulty: 'asc' }, { usageCount: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, normalizedTitle: true, difficulty: true },
  })
  return rows.filter((row) => !realKeys.has(normalizeWantListenTitle(row.title)))
}

function selectSongForQuestion(pool: readonly WantListenSongCandidate[], usedIds: ReadonlySet<string>) {
  return shuffle(pool.filter((song) => !usedIds.has(song.id)).length ? pool.filter((song) => !usedIds.has(song.id)) : pool)
}

function buildQuestionForSongMode(pool: readonly WantListenSongCandidate[], position: number, usedIds: Set<string>): PreparedQuestion {
  for (const song of selectSongForQuestion(pool, usedIds)) {
    const question = buildWantListenQuestion(song, pool)
    if (question) {
      usedIds.add(song.id)
      return question
    }
  }
  throw new WantListenServiceError('当前曲库可用歌曲不足，暂时无法开始「想听」。', 409, 'QUESTION_BANK_INSUFFICIENT')
}

function buildQuestionForCantoneseMode(pool: readonly WantListenSongCandidate[], position: number, usedIds: Set<string>): PreparedQuestion {
  for (const song of selectSongForQuestion(pool, usedIds)) {
    const question = buildCantoneseFragmentQuestion(song, pool, position)
    if (question && validateQuestion(question.data)) {
      usedIds.add(song.id)
      return question
    }
  }
  throw new WantListenServiceError('当前粤语歌词题库不足，暂时无法开始「粤语残片」。', 409, 'QUESTION_BANK_INSUFFICIENT')
}

function fakeDifficultyOrder(preferred: WantListenFakeTitleDifficulty) {
  if (preferred === 'EASY') return ['EASY', 'NORMAL', 'HARD'] as const
  if (preferred === 'HARD') return ['HARD', 'NORMAL', 'EASY'] as const
  return ['NORMAL', 'EASY', 'HARD'] as const
}

function selectFakeTitle(
  fakes: readonly { id: string; title: string; difficulty: WantListenFakeTitleDifficulty }[],
  position: number,
  usedIds: ReadonlySet<string>,
) {
  const preferred = difficultyForQuestion(position)
  for (const difficulty of fakeDifficultyOrder(preferred)) {
    const available = fakes.filter((fake) => fake.difficulty === difficulty && !usedIds.has(fake.id))
    if (available.length) return available[0]
  }
  for (const difficulty of fakeDifficultyOrder(preferred)) {
    const available = fakes.filter((fake) => fake.difficulty === difficulty)
    if (available.length) return available[0]
  }
  return null
}

/**
 * 无尽模式：按需生成单道题目（无限挑战，不预生成 20 题）。
 * 排除上一题来源歌曲 / 假歌名，池耗尽时按现有回退逻辑复用（可无限循环）。
 */
async function buildQuestionAtPosition(mode: WantListenMode, position: number, excludedSongIds: ReadonlySet<string>, excludedFakeIds: ReadonlySet<string>): Promise<PreparedQuestion> {
  if (mode === 'FALSE_TITLE') {
    const realTitles = await loadRealTitles()
    if (realTitles.length < 5) throw new WantListenServiceError('当前真实曲库不足，暂时无法开始「防不胜防」。', 409, 'QUESTION_BANK_INSUFFICIENT')
    const fakes = await loadActiveFakeTitles(realTitles)
    const fake = selectFakeTitle(fakes, position, excludedFakeIds)
    if (!fake) throw new WantListenServiceError('当前假歌名库暂时不足，请管理员补充后再试。', 409, 'FAKE_TITLE_BANK_INSUFFICIENT')
    const question = buildFalseTitleQuestion(realTitles, fake.title, fake.difficulty)
    if (!question) throw new WantListenServiceError('当前真实曲库不足，暂时无法开始「防不胜防」。', 409, 'QUESTION_BANK_INSUFFICIENT')
    question.data.fakeTitleId = fake.id
    return { ...question, fakeTitleId: fake.id }
  }

  const pool = await loadSongPool(mode)
  if (pool.length < 4) throw new WantListenServiceError(mode === 'WANT_LISTEN' ? '当前曲库可用歌曲不足，暂时无法开始「想听」。' : '当前粤语歌词题库不足，暂时无法开始「粤语残片」。', 409, 'QUESTION_BANK_INSUFFICIENT')
  return mode === 'WANT_LISTEN'
    ? buildQuestionForSongMode(pool, position, new Set(excludedSongIds))
    : buildQuestionForCantoneseMode(pool, position, new Set(excludedSongIds))
}

/** 无尽模式：事务内追加下一题（记录服务端开始时间，供反作弊耗时校验） */
async function generateNextQuestion(database: Prisma.TransactionClient | typeof prisma, session: { id: string; mode: WantListenMode }, position: number) {
  const previous = await database.wantListenSessionQuestion.findFirst({
    where: { sessionId: session.id },
    orderBy: { position: 'desc' },
    select: { questionData: true },
  })
  const prevData = previous ? (previous.questionData as unknown as WantListenStoredQuestion) : null
  const prepared = await buildQuestionAtPosition(
    session.mode,
    position,
    prevData?.songId ? new Set([prevData.songId]) : new Set(),
    prevData?.fakeTitleId ? new Set([prevData.fakeTitleId]) : new Set(),
  )
  await database.wantListenSessionQuestion.create({
    data: {
      sessionId: session.id,
      publicId: randomUUID(),
      position,
      questionData: prepared.data as unknown as Prisma.InputJsonValue,
      correctOptionKey: prepared.correctOptionKey,
      questionStartedAt: new Date(),
    },
  })
  if (prepared.fakeTitleId) await database.wantListenFakeTitle.update({ where: { id: prepared.fakeTitleId }, data: { usageCount: { increment: 1 } } })
}

async function loadSessionRaw(userId: string, sessionId: string) {
  return prisma.wantListenSession.findFirst({
    where: { id: sessionId, userId },
    include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } },
  })
}

async function expireSessionIfNeeded(userId: string, sessionId: string, now = new Date()) {
  // 宽限窗口：仅当超过 expiresAt + GRACE 才判定 EXPIRED；
  // 刚过期的会话保留 IN_PROGRESS，由下一次真实操作滑动续期恢复。
  await prisma.wantListenSession.updateMany({
    where: { id: sessionId, userId, status: 'IN_PROGRESS', expiresAt: { lte: new Date(now.getTime() - WANT_LISTEN_EXPIRY_GRACE_MS) } },
    data: { status: 'EXPIRED', activeKey: null },
  })
}

/**
 * 滑动过期：真实用户行为（读状态 / 答题 / 提示 / 下一题 / 恢复）刷新不活动窗口。
 * 只在 `expiresAt <= now + TTL` 时前移，并发/延迟的旧请求不会把有效期回拨。
 */
async function refreshWantListenExpiry(userId: string, sessionId: string, now = new Date()) {
  const nextExpiry = new Date(now.getTime() + WANT_LISTEN_SESSION_TTL_MS)
  await prisma.wantListenSession.updateMany({
    where: { id: sessionId, userId, status: 'IN_PROGRESS', expiresAt: { lte: nextExpiry } },
    data: { expiresAt: nextExpiry },
  })
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * 当前题缺失自动恢复：Session 仍 IN_PROGRESS、有效期有效，但 currentQuestion
 * 指向的题目记录不存在时，在不改变 score / correctCount / streak / currentQuestion
 * 的前提下按当前题号重建题目（历史答题记录保持不变）。
 */
async function ensureCurrentQuestionExists(session: SessionWithQuestions, now = new Date()): Promise<SessionWithQuestions> {
  if (session.status !== 'IN_PROGRESS') return session
  // 超过宽限窗口的会话不再恢复（由 expireSessionIfNeeded 判定 EXPIRED）
  if (session.expiresAt.getTime() <= now.getTime() - WANT_LISTEN_EXPIRY_GRACE_MS) return session
  const hasCurrent = session.WantListenSessionQuestion.some((question) => question.position === session.currentQuestion)
  if (hasCurrent) return session
  // 历史固定题数模式：当前题号超出题目总数时视为正常结束，不重建
  if (session.questionCount !== null && session.currentQuestion > session.questionCount) return session
  try {
    await generateNextQuestion(prisma, session, session.currentQuestion)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // 并发恢复：题目已由其他请求创建，重新加载即可
      const reloaded = await loadSession(session.userId, session.id)
      return reloaded ?? session
    }
    if (error instanceof WantListenServiceError) throw error
    throw error
  }
  const reloaded = await loadSession(session.userId, session.id)
  return reloaded ?? session
}

function storedQuestion(question: SessionWithQuestions['WantListenSessionQuestion'][number]) {
  return question.questionData as unknown as WantListenStoredQuestion
}

async function repairCantoneseSessionQuestions(session: SessionWithQuestions): Promise<SessionWithQuestions> {
  if (session.mode !== 'CANTONESE_FRAGMENT' || session.status !== 'IN_PROGRESS') return session

  const byPosition = new Map(session.WantListenSessionQuestion.map((question) => [question.position, question]))
  const positionsToReplace: Array<{ position: number; question?: SessionWithQuestions['WantListenSessionQuestion'][number] }> = []
  // 无尽模式（questionCount 为 null）时只检查已生成的题目
  const total = session.questionCount ?? session.WantListenSessionQuestion.length
  for (let position = 1; position <= total; position += 1) {
    const question = byPosition.get(position)
    if (!question || (!question.answeredAt && !validateQuestion(storedQuestion(question)))) {
      positionsToReplace.push({ position, question })
    }
  }
  if (!positionsToReplace.length) return session

  const pool = await loadSongPool('CANTONESE_FRAGMENT')
  if (pool.length < 4) throw new WantListenServiceError('当前粤语歌词题库不足，暂时无法补齐有效题目。', 409, 'QUESTION_BANK_INSUFFICIENT')

  const usedIds = new Set<string>()
  for (const question of session.WantListenSessionQuestion) {
    const data = storedQuestion(question)
    if (validateQuestion(data) && data.songId) usedIds.add(data.songId)
  }

  const replacements = positionsToReplace.map(({ position, question }) => ({
    position,
    question,
    prepared: buildQuestionForCantoneseMode(pool, position, usedIds),
  }))
  if (replacements.some(({ prepared }) => !validateQuestion(prepared.data))) {
    throw new WantListenServiceError('当前粤语歌词题库不足，暂时无法补齐有效题目。', 409, 'QUESTION_BANK_INSUFFICIENT')
  }

  await transactionWithRetry(async (database) => {
    const active = await database.wantListenSession.findFirst({ where: { id: session.id, userId: session.userId, status: 'IN_PROGRESS' }, select: { id: true } })
    if (!active) return
    for (const replacement of replacements) {
      const data = {
        questionData: replacement.prepared.data as unknown as Prisma.InputJsonValue,
        correctOptionKey: replacement.prepared.correctOptionKey,
      }
      if (replacement.question) {
        await database.wantListenSessionQuestion.updateMany({
          where: { id: replacement.question.id, sessionId: session.id, answeredAt: null },
          data: { ...data, publicId: randomUUID(), hintLevel: 1, selectedOptionKey: null, isCorrect: null, awardedScore: 0, answeredAt: null },
        })
      } else {
        await database.wantListenSessionQuestion.create({
          data: { sessionId: session.id, publicId: randomUUID(), position: replacement.position, ...data },
        })
      }
    }
  })

  return (await loadSessionRaw(session.userId, session.id)) || session
}

async function loadSession(userId: string, sessionId: string) {
  const session = await loadSessionRaw(userId, sessionId)
  return session ? repairCantoneseSessionQuestions(session) : null
}

function publicQuestion(session: SessionWithQuestions, question: SessionWithQuestions['WantListenSessionQuestion'][number] | undefined) {
  if (!question || session.status === 'ABANDONED' || session.status === 'EXPIRED') return null
  const data = storedQuestion(question)
  if (session.mode === 'CANTONESE_FRAGMENT' && !validateQuestion(data)) return null
  const answered = Boolean(question.answeredAt)
  const result = answered
    ? {
      selectedOptionKey: question.selectedOptionKey,
      correctOptionKey: question.correctOptionKey,
      correct: question.isCorrect === true,
      awardedScore: question.awardedScore,
      correctAnswer: session.mode === 'WANT_LISTEN'
        ? data.songTitle || ''
        : session.mode === 'CANTONESE_FRAGMENT'
          ? data.correctLyric || ''
          : data.options?.find((option) => option.key === question.correctOptionKey)?.label || '',
      songTitle: data.songTitle || null,
      completeContext: data.completeContext || null,
    }
    : null

  return {
    id: question.publicId,
    position: question.position,
    hintLevel: question.hintLevel,
    options: data.options || [],
    hints: session.mode === 'WANT_LISTEN' ? (data.hints || []).slice(0, Math.min(4, question.hintLevel)) : [],
    context: session.mode === 'CANTONESE_FRAGMENT' ? data.maskedContext || '' : null,
    result,
  }
}

export type WantListenPublicState = {
  id: string
  mode: WantListenMode
  modeLabel: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'EXPIRED'
  currentQuestion: number
  totalQuestions: number | null          // null = 无尽模式
  totalAnswered: number                  // 已答总题数（无尽累计）
  currentStreak: number
  maxStreak: number
  wrongCount: number
  livesRemaining: number
  maxWrongCount: number
  score: number
  correctCount: number
  startedAt: string
  completedAt: string | null
  completionTimeMs: number | null
  expiresAt: string
  question: ReturnType<typeof publicQuestion>
}

function toPublicState(session: SessionWithQuestions): WantListenPublicState {
  const question = session.WantListenSessionQuestion.find((item) => item.position === session.currentQuestion)
  return {
    id: session.id,
    mode: session.mode,
    modeLabel: WANT_LISTEN_MODE_LABELS[session.mode],
    status: session.status,
    currentQuestion: session.currentQuestion,
    totalQuestions: session.questionCount,
    totalAnswered: session.totalQuestions,
    currentStreak: session.currentStreak,
    maxStreak: session.maxStreak,
    wrongCount: session.wrongCount,
    livesRemaining: session.livesRemaining,
    maxWrongCount: WANT_LISTEN_MAX_WRONG_COUNT,
    score: session.score,
    correctCount: session.correctCount,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() || null,
    completionTimeMs: session.completionTimeMs,
    expiresAt: session.expiresAt.toISOString(),
    question: publicQuestion(session, question),
  }
}

function sessionNotFound() {
  return new WantListenServiceError('游戏不存在或无权访问。', 404, 'SESSION_NOT_FOUND')
}

function ensureMode(value: unknown): WantListenMode {
  if (!isWantListenMode(value)) throw new WantListenServiceError('游戏模式无效。', 400, 'MODE_INVALID')
  return value
}

async function ensureModeAvailable(mode: WantListenMode) {
  const config = await getWantListenConfig()
  if (!isWantListenModeEnabled(config, mode)) throw new WantListenServiceError('该游戏模式当前已暂停，请稍后再试。', 409, 'MODE_DISABLED')
}

function wantListenGameType(mode: WantListenMode) {
  return `want-listen:${mode}`
}

export async function createWantListenSession(userId: string, rawMode: unknown, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const mode = ensureMode(rawMode)
  const now = new Date()
  // 1) 已过期的进行中会话 → EXPIRED（清理 TTL 过期残留）
  await prisma.wantListenSession.updateMany({ where: { userId, mode, status: 'IN_PROGRESS', expiresAt: { lte: now } }, data: { status: 'EXPIRED', activeKey: null } })
  // 2) 同模式所有有效进行中会话：保留最新一次，其余历史残留 → ABANDONED（不删除数据）
  const activeSessions = await prisma.wantListenSession.findMany({ where: { userId, mode, status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (activeSessions.length > 1) {
    await prisma.wantListenSession.updateMany({ where: { id: { in: activeSessions.slice(1).map((session) => session.id) } }, data: { status: 'ABANDONED', activeKey: null } })
  }
  // 3) 已有唯一有效进行中会话 → 直接返回其 sessionId（继续游戏），不重复创建
  const existing = activeSessions[0]
  if (existing) {
    // 恢复进行中会话也是真实活跃行为：刷新滑动过期窗口
    await refreshWantListenExpiry(userId, existing.id, now)
    const restored = await loadSession(userId, existing.id)
    if (!restored) throw sessionNotFound()
    return { resumed: true, session: toPublicState(restored) }
  }
  await ensureModeAvailable(mode)

  // 无尽模式：仅生成第 1 题，后续题目在「下一题」时动态生成
  const firstQuestion = await buildQuestionAtPosition(mode, 1, new Set(), new Set())
  try {
    const created = await transactionWithRetry(async (database) => {
      const sessionId = randomUUID()
      const session = await database.wantListenSession.create({
        data: {
          id: sessionId,
          activeKey: `${userId}:${mode}`,
          userId,
          mode,
          currentQuestion: 1,
          questionCount: null,
          totalQuestions: 0,
          currentStreak: 0,
          maxStreak: 0,
          wrongCount: 0,
          livesRemaining: WANT_LISTEN_MAX_WRONG_COUNT,
          expiresAt: new Date(now.getTime() + WANT_LISTEN_SESSION_TTL_MS),
          ipAddress: meta.ip?.slice(0, 64) || null,
          userAgent: meta.userAgent?.slice(0, 500) || null,
          WantListenSessionQuestion: {
            create: {
              publicId: randomUUID(),
              position: 1,
              questionData: firstQuestion.data as unknown as Prisma.InputJsonValue,
              correctOptionKey: firstQuestion.correctOptionKey,
              // 服务端记录第 1 题的开始时间，后续题目在 next 时记录
              questionStartedAt: now,
            },
          },
        },
        select: { id: true },
      })
      if (firstQuestion.fakeTitleId) await database.wantListenFakeTitle.update({ where: { id: firstQuestion.fakeTitleId }, data: { usageCount: { increment: 1 } } })
      return session
    })
    const session = await loadSession(userId, created.id)
    if (!session) throw sessionNotFound()
    return { resumed: false, session: toPublicState(session) }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await prisma.wantListenSession.findFirst({ where: { userId, mode, status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' } })
      if (concurrent) {
        const restored = await loadSession(userId, concurrent.id)
        if (restored) return { resumed: true, session: toPublicState(restored) }
      }
    }
    throw error
  }
}

export async function getWantListenSessionState(userId: string, sessionId: string) {
  await expireSessionIfNeeded(userId, sessionId)
  let session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  // 读取状态属于真实活跃行为：刷新滑动过期窗口
  await refreshWantListenExpiry(userId, sessionId)
  // 当前题缺失时自动重建（不改变分数/连击/题号），避免「当前题目不可用」中断整局
  session = await ensureCurrentQuestionExists(session)
  return toPublicState(session)
}

export async function requestWantListenHint(userId: string, sessionId: string) {
  await expireSessionIfNeeded(userId, sessionId)
  let session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  if (session.status !== 'IN_PROGRESS') {
    if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
    return toPublicState(session)
  }
  if (session.mode !== 'WANT_LISTEN') throw new WantListenServiceError('该模式没有逐层提示。', 400, 'HINT_NOT_AVAILABLE')
  // 当前题缺失时先自动恢复，再取提示
  session = await ensureCurrentQuestionExists(session)
  const current = session.WantListenSessionQuestion.find((item) => item.position === session.currentQuestion)
  if (!current) throw new WantListenServiceError('当前题目不存在，请重新开始。', 409, 'QUESTION_MISSING')
  if (current.answeredAt) return toPublicState(session)
  if (current.hintLevel >= WANT_LISTEN_MAX_HINTS + 1) return toPublicState(session)
  await prisma.wantListenSessionQuestion.updateMany({
    where: { id: current.id, answeredAt: null, hintLevel: { lt: WANT_LISTEN_MAX_HINTS + 1 } },
    data: { hintLevel: { increment: 1 } },
  })
  return getWantListenSessionState(userId, sessionId)
}

async function updateWantListenStats(database: Prisma.TransactionClient, session: SessionWithQuestions, answeredQuestionId: string, answeredCorrect: boolean, answeredHintLevel: number, finalScore: number, finalCorrectCount: number) {
  const existing = await database.wantListenStats.findUnique({ where: { userId_mode: { userId: session.userId, mode: session.mode } } })
  let currentStreak = existing?.currentStreak || 0
  let maxStreak = existing?.maxStreak || 0
  let silentCurrentStreak = existing?.silentCurrentStreak || 0
  let silentMaxStreak = existing?.silentMaxStreak || 0
  const resolved = session.WantListenSessionQuestion.map((question) => question.id === answeredQuestionId
    ? { isCorrect: answeredCorrect, hintLevel: answeredHintLevel }
    : { isCorrect: question.isCorrect === true, hintLevel: question.hintLevel })
  for (const question of resolved) {
    if (question.isCorrect) {
      currentStreak += 1
      maxStreak = Math.max(maxStreak, currentStreak)
    } else {
      currentStreak = 0
    }
    if (session.mode === 'WANT_LISTEN' && question.isCorrect && question.hintLevel <= WANT_LISTEN_MAX_HINTS) {
      silentCurrentStreak += 1
      silentMaxStreak = Math.max(silentMaxStreak, silentCurrentStreak)
    } else if (session.mode === 'WANT_LISTEN') {
      silentCurrentStreak = 0
    }
  }
  // 无尽模式：本次对局答过的题数（questionCount=null 时用 totalQuestions）
  const answeredCount = session.totalQuestions || session.questionCount || 0
  await database.wantListenStats.upsert({
    where: { userId_mode: { userId: session.userId, mode: session.mode } },
    create: {
      userId: session.userId,
      mode: session.mode,
      gamesPlayed: 1,
      totalQuestions: answeredCount,
      totalCorrect: finalCorrectCount,
      bestScore: finalScore,
      currentStreak,
      maxStreak,
      silentCurrentStreak,
      silentMaxStreak,
    },
    update: {
      gamesPlayed: { increment: 1 },
      totalQuestions: { increment: answeredCount },
      totalCorrect: { increment: finalCorrectCount },
      bestScore: Math.max(existing?.bestScore || 0, finalScore),
      currentStreak,
      maxStreak,
      silentCurrentStreak,
      silentMaxStreak,
    },
  })
}

export async function answerWantListenQuestion(input: { userId: string; sessionId: string; publicQuestionId: string; optionKey: string; ip?: string | null; userAgent?: string | null }) {
  const optionKey = input.optionKey.trim().slice(0, 100)
  if (!optionKey) throw new WantListenServiceError('请选择一个答案。', 400, 'ANSWER_INVALID')
  await expireSessionIfNeeded(input.userId, input.sessionId)
  let preSession = await loadSession(input.userId, input.sessionId)
  if (!preSession) throw sessionNotFound()
  // 当前题缺失时先自动恢复（若仍在有效期内），避免答题直接判「题目不可用」
  preSession = await ensureCurrentQuestionExists(preSession)
  const result = await transactionWithRetry(async (database) => {
    const session = await database.wantListenSession.findFirst({ where: { id: input.sessionId, userId: input.userId }, include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } } })
    if (!session) throw sessionNotFound()
    if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
    if (session.status === 'ABANDONED') throw new WantListenServiceError('本局游戏已退出，请重新开始。', 409, 'SESSION_ABANDONED')
    const current = session.WantListenSessionQuestion.find((question) => question.position === session.currentQuestion)
    if (!current) throw new WantListenServiceError('当前题目不存在，请重新开始。', 409, 'QUESTION_MISSING')
    if (current.publicId !== input.publicQuestionId) throw new WantListenServiceError('当前题目已变化，请刷新后继续。', 409, 'QUESTION_MISMATCH')
    if (current.answeredAt) {
      // 重复提交：同一题只能提交一次（需求 6），记录异常
      await recordAntiCheatLog(database, {
        userId: session.userId,
        gameType: wantListenGameType(session.mode),
        sessionId: session.id,
        questionCount: session.questionCount,
        ip: input.ip,
        userAgent: input.userAgent,
        suspiciousType: 'REPEATED_SUBMIT',
        details: { reason: `重复提交第 ${current.position} 题`, questionId: current.id } as Prisma.InputJsonValue,
      })
      return { duplicate: true, sessionId: session.id, questionId: current.id, finalized: session.status === 'COMPLETED' }
    }
    const data = storedQuestion(current)
    if (!data.options?.some((option) => option.key === optionKey)) throw new WantListenServiceError('请选择当前题目中的一个选项。', 400, 'ANSWER_INVALID')
    const isCorrect = optionKey === current.correctOptionKey
    // 无尽模式：连击 + 基础分（答对 100，每连续 10 题 +270）
    const nextStreak = isCorrect ? session.currentStreak + 1 : 0
    const nextWrongCount = session.wrongCount + (isCorrect ? 0 : 1)
    const livesAfter = Math.max(0, session.livesRemaining - (isCorrect ? 0 : 1))
    // 本题得分必须由服务端权威的提示次数计算：hintsUsed = hintLevel - 1（绝不信客户端传入）
    const awardedScore = scoreForWantListenAnswer(isCorrect, nextStreak, current.hintLevel - 1)
    // 服务端计时：耗时 = answeredAt - questionStartedAt，不信任客户端时间
    const answeredAt = new Date()
    const latencyMs = computeServerElapsedMs(current.questionStartedAt, answeredAt)
    const updatedQuestionCount = await database.wantListenSessionQuestion.updateMany({
      where: { id: current.id, answeredAt: null },
      data: { selectedOptionKey: optionKey, isCorrect, awardedScore, answeredAt, answerLatencyMs: latencyMs },
    })
    if (updatedQuestionCount.count !== 1) return { duplicate: true, sessionId: session.id, questionId: current.id, finalized: session.status === 'COMPLETED' }
    const finalScore = session.score + awardedScore
    const finalCorrectCount = session.correctCount + (isCorrect ? 1 : 0)
    // 结束条件：
    //  - 历史固定题数模式（questionCount 非空）：答完最后一题
    //  - 无尽模式（questionCount 为 null）：答错耗尽生命
    const isFinal = session.questionCount !== null
      ? session.currentQuestion >= session.questionCount
      : nextWrongCount >= WANT_LISTEN_MAX_WRONG_COUNT
    const completedAt = isFinal ? new Date() : null
    const updated = await database.wantListenSession.update({
      where: { id: session.id },
      data: {
        score: finalScore,
        correctCount: finalCorrectCount,
        totalQuestions: { increment: 1 },
        currentStreak: nextStreak,
        maxStreak: Math.max(session.maxStreak, nextStreak),
        wrongCount: nextWrongCount,
        livesRemaining: livesAfter,
        // 滑动过期：每次有效答题都刷新不活动窗口
        expiresAt: new Date(Date.now() + WANT_LISTEN_SESSION_TTL_MS),
        ...(isFinal
          ? { status: 'COMPLETED', completedAt, completionTimeMs: Math.max(0, (completedAt?.getTime() || Date.now()) - session.startedAt.getTime()), activeKey: null }
          : {}),
      },
      include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } },
    })

    // 反作弊评估：基于服务端记录的每题耗时
    const answeredLatencies = updated.WantListenSessionQuestion
      .filter((question) => question.answeredAt && question.answerLatencyMs !== null && question.answerLatencyMs !== undefined)
      .map((question) => question.answerLatencyMs as number)
    const fastest = fastestAnswerTime(answeredLatencies)
    const average = averageAnswerTime(answeredLatencies)
    const assessment = assessWantListenLatencies(answeredLatencies)
    const fastCount = answeredLatencies.filter((ms) => isSingleAnswerTooFast(ms)).length
    const antiCheatContext = {
      userId: session.userId,
      gameType: wantListenGameType(session.mode),
      sessionId: session.id,
      questionCount: updated.totalQuestions,
      fastestAnswerTime: fastest,
      averageAnswerTime: average,
      ip: input.ip,
      userAgent: input.userAgent,
    }
    if (assessment.suspicious && session.antiCheatStatus !== 'SUSPICIOUS') {
      // 高风险：平均 <2s 或连续 5 题 <1s → 标记 SUSPICIOUS，不进排行榜
      await database.wantListenSession.update({
        where: { id: session.id },
        data: { antiCheatStatus: 'SUSPICIOUS', antiCheatReasons: assessment.reasons as unknown as Prisma.InputJsonValue },
      })
      await recordAntiCheatLog(database, {
        ...antiCheatContext,
        suspiciousType: 'FAST_ANSWER',
        details: { reasons: assessment.reasons, mode: session.mode, score: finalScore, correctCount: finalCorrectCount, latencies: answeredLatencies } as Prisma.InputJsonValue,
      })
    } else if (isSingleAnswerTooFast(latencyMs) && fastCount === 1 && session.antiCheatStatus !== 'SUSPICIOUS') {
      // 单题 <1s：记录异常但暂不升级会话状态（避免正常波动误伤）
      await recordAntiCheatLog(database, {
        ...antiCheatContext,
        suspiciousType: 'FAST_ANSWER',
        details: { reason: `单题答题时间 ${latencyMs}ms 低于 1 秒`, mode: session.mode, latencyMs } as Prisma.InputJsonValue,
      })
    }

    if (isFinal && !assessment.suspicious) {
      await updateWantListenStats(database, updated, '', false, 1, finalScore, finalCorrectCount)
      await recordWantListenLeaderboard(session.id, database)
    }
    return { duplicate: false, sessionId: updated.id, questionId: current.id, finalized: isFinal }
  })
  const state = await getWantListenSessionState(input.userId, input.sessionId)
  if (result.finalized && !result.duplicate) {
    await syncUserAchievements(input.userId, ['SPECIAL']).catch((error) => console.error('[want-listen.achievements]', error))
    triggerBadgeEvaluation(input.userId, 'WANT_LISTEN_SESSION_FINISHED')
  }
  const answerQuestion = state.question
  return {
    duplicate: result.duplicate,
    state,
    result: answerQuestion?.result || null,
    finalized: result.finalized,
  }
}

export async function nextWantListenQuestion(userId: string, sessionId: string, publicQuestionId?: string) {
  await expireSessionIfNeeded(userId, sessionId)
  let session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
  if (session.status === 'COMPLETED') return toPublicState(session)
  session = await ensureCurrentQuestionExists(session)
  const current = session.WantListenSessionQuestion.find((question) => question.position === session.currentQuestion)
  const submitted = publicQuestionId
    ? session.WantListenSessionQuestion.find((question) => question.publicId === publicQuestionId)
    : current
  if (publicQuestionId && !submitted) throw new WantListenServiceError('当前题目已变化，请刷新后继续。', 409, 'QUESTION_MISMATCH')
  if (publicQuestionId && submitted && submitted.position !== session.currentQuestion) {
    // 客户端可能在上一条 /next 已提交成功、但响应丢失后重放请求。
    // 只要请求绑定的题目已经完成且服务端已进入后续题，直接返回当前状态，保证 /next 幂等。
    if (submitted.answeredAt && submitted.position < session.currentQuestion) return toPublicState(session)
    throw new WantListenServiceError('当前题目已变化，请刷新后继续。', 409, 'QUESTION_MISMATCH')
  }
  if (!current?.answeredAt) throw new WantListenServiceError('请先提交当前题目。', 409, 'QUESTION_NOT_ANSWERED')
  // 历史固定题数模式：答完最后一题后不再推进
  if (session.questionCount !== null && session.currentQuestion >= session.questionCount) return toPublicState(session)
  const nextPosition = session.currentQuestion + 1
  // 推进 + 生成下一题必须在同一事务：题目生成失败时 currentQuestion 不会提前推进，
  // 避免出现「Session 已指向下一题但数据库没有该题」的半完成状态。
  const advanced = await transactionWithRetry(async (database) => {
    const updated = await database.wantListenSession.updateMany({
      where: { id: session.id, userId, status: 'IN_PROGRESS', currentQuestion: session.currentQuestion },
      data: {
        currentQuestion: { increment: 1 },
        // 滑动过期：下一题也是真实活跃行为
        expiresAt: new Date(Date.now() + WANT_LISTEN_SESSION_TTL_MS),
      },
    })
    if (updated.count !== 1) return false
    if (session.questionCount === null) {
      // 无尽模式：事务内动态生成下一题（失败则整体回滚）
      await generateNextQuestion(database, session, nextPosition)
    } else {
      await database.wantListenSessionQuestion.updateMany({
        where: { sessionId: session.id, position: nextPosition, answeredAt: null },
        data: { questionStartedAt: new Date() },
      })
    }
    return true
  })
  if (!advanced) return getWantListenSessionState(userId, sessionId)
  return getWantListenSessionState(userId, sessionId)
}

export async function abandonWantListenSession(userId: string, sessionId: string) {
  await prisma.wantListenSession.updateMany({ where: { id: sessionId, userId, status: 'IN_PROGRESS' }, data: { status: 'ABANDONED', activeKey: null } })
  return getWantListenSessionState(userId, sessionId)
}

/**
 * 无尽模式：用户主动结束 → 保存本次成绩（COMPLETED）。
 * 反作弊评估沿用服务端耗时判定；CLEAN 才写入统计与排行榜。
 */
export async function finishWantListenSession(userId: string, sessionId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  await expireSessionIfNeeded(userId, sessionId)
  const session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  if (session.status === 'COMPLETED') return toPublicState(session)
  if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
  if (session.status === 'ABANDONED') throw new WantListenServiceError('本局游戏已退出，请重新开始。', 409, 'SESSION_ABANDONED')

  const result = await transactionWithRetry(async (database) => {
    const active = await database.wantListenSession.findFirst({
      where: { id: sessionId, userId },
      include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } },
    })
    if (!active) throw sessionNotFound()
    if (active.status !== 'IN_PROGRESS') return { duplicate: true, finalized: active.status === 'COMPLETED' }

    const finishedAt = new Date()
    const claimed = await database.wantListenSession.updateMany({
      where: { id: active.id, userId, status: 'IN_PROGRESS' },
      data: {
        status: 'COMPLETED',
        completedAt: finishedAt,
        completionTimeMs: Math.max(0, finishedAt.getTime() - active.startedAt.getTime()),
        activeKey: null,
      },
    })
    if (claimed.count !== 1) {
      const latest = await database.wantListenSession.findFirst({ where: { id: active.id, userId }, select: { status: true } })
      return { duplicate: true, finalized: latest?.status === 'COMPLETED' }
    }
    const updated = await database.wantListenSession.findFirst({
      where: { id: active.id, userId },
      include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } },
    })
    if (!updated) throw sessionNotFound()

    // 反作弊评估：基于服务端记录的全部已答耗时
    const answeredLatencies = updated.WantListenSessionQuestion
      .filter((question) => question.answeredAt && question.answerLatencyMs !== null && question.answerLatencyMs !== undefined)
      .map((question) => question.answerLatencyMs as number)
    const assessment = assessWantListenLatencies(answeredLatencies)
    if (assessment.suspicious && active.antiCheatStatus !== 'SUSPICIOUS') {
      await database.wantListenSession.update({
        where: { id: active.id },
        data: { antiCheatStatus: 'SUSPICIOUS', antiCheatReasons: assessment.reasons as unknown as Prisma.InputJsonValue },
      })
      await recordAntiCheatLog(database, {
        userId: active.userId,
        gameType: wantListenGameType(active.mode),
        sessionId: active.id,
        questionCount: active.totalQuestions,
        fastestAnswerTime: fastestAnswerTime(answeredLatencies),
        averageAnswerTime: averageAnswerTime(answeredLatencies),
        ip: meta.ip,
        userAgent: meta.userAgent,
        suspiciousType: 'FAST_ANSWER',
        details: { reasons: assessment.reasons, mode: active.mode, score: active.score, correctCount: active.correctCount, latencies: answeredLatencies } as Prisma.InputJsonValue,
      })
    }

    if (!assessment.suspicious) {
      await updateWantListenStats(database, updated, '', false, 1, updated.score, updated.correctCount)
      await recordWantListenLeaderboard(active.id, database)
    }
    return { duplicate: false, finalized: true }
  })

  if (result.finalized && !result.duplicate) {
    await syncUserAchievements(userId, ['SPECIAL']).catch((error) => console.error('[want-listen.achievements]', error))
    triggerBadgeEvaluation(userId, 'WANT_LISTEN_SESSION_FINISHED')
  }
  return getWantListenSessionState(userId, sessionId)
}

type StatsRow = {
  mode: WantListenMode
  gamesPlayed: number
  totalQuestions: number
  totalCorrect: number
  bestScore: number
  currentStreak: number
  maxStreak: number
  perfectGames: number
  silentCurrentStreak: number
  silentMaxStreak: number
}

type WantListenSummaryDatabase = Pick<typeof prisma, 'siteSetting' | 'wantListenStats' | 'wantListenSession'>

function summaryReadErrorDetails(error: unknown) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null
  return {
    errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    errorCode: record && 'code' in record ? String(record.code) : undefined,
    message: error instanceof Error ? error.message : String(error),
  }
}

function logDegradedSummaryRead(area: string, error: unknown) {
  console.warn(`[want-listen.summary.${area}.degraded]`, summaryReadErrorDetails(error))
}

function serializeStats(row: StatsRow | undefined) {
  const totalQuestions = row?.totalQuestions || 0
  return {
    gamesPlayed: row?.gamesPlayed || 0,
    bestScore: row?.bestScore || 0,
    totalQuestions,
    totalCorrect: row?.totalCorrect || 0,
    accuracy: totalQuestions ? Math.round(((row?.totalCorrect || 0) / totalQuestions) * 1000) / 10 : 0,
    currentStreak: row?.currentStreak || 0,
    maxStreak: row?.maxStreak || 0,
    perfectGames: row?.perfectGames || 0,
    silentCurrentStreak: row?.silentCurrentStreak || 0,
    silentMaxStreak: row?.silentMaxStreak || 0,
  }
}

export async function getWantListenSummary(userId: string, database: WantListenSummaryDatabase = prisma) {
  const now = new Date()
  // 已过期的进行中会话 → EXPIRED（避免过期残留让前端误判为「继续游戏」）
  try {
    await database.wantListenSession.updateMany({ where: { userId, status: 'IN_PROGRESS', expiresAt: { lte: now } }, data: { status: 'EXPIRED', activeKey: null } })
  } catch (error) {
    // 清理只是首页展示的 housekeeping；创建/恢复 session 会再次做权威检查。
    logDegradedSummaryRead('expired-session-cleanup', error)
  }
  const [configResult, statsResult, activeResult] = await Promise.allSettled([
    getWantListenConfig(database),
    database.wantListenStats.findMany({ where: { userId }, select: { mode: true, gamesPlayed: true, totalQuestions: true, totalCorrect: true, bestScore: true, currentStreak: true, maxStreak: true, perfectGames: true, silentCurrentStreak: true, silentMaxStreak: true } }),
    database.wantListenSession.findMany({ where: { userId, status: 'IN_PROGRESS', expiresAt: { gt: now } }, orderBy: { updatedAt: 'desc' }, select: { id: true, mode: true, currentQuestion: true, score: true, correctCount: true, expiresAt: true } }),
  ])
  const statsRead = settleOptionalWantListenRead(statsResult, [])
  const activeRead = settleOptionalWantListenRead(activeResult, [])
  if (!statsRead.available) logDegradedSummaryRead('stats', statsRead.reason)
  if (!activeRead.available) logDegradedSummaryRead('active-sessions', activeRead.reason)
  // Configuration is the only summary read that decides whether a mode may be
  // started. It remains a core dependency and must not silently default open.
  if (configResult.status === 'rejected') throw configResult.reason
  const config = configResult.value
  const rows = statsRead.value
  const active = activeRead.value
  // 每个模式只暴露最新一个有效进行中会话，避免同模式多 session 残留时前端 Map 状态混乱
  const latestActiveByMode = new Map<string, (typeof active)[number]>()
  for (const session of active) {
    if (!latestActiveByMode.has(session.mode)) latestActiveByMode.set(session.mode, session)
  }
  const byMode = new Map(rows.map((row) => [row.mode, row]))
  const modeStats = Object.fromEntries(WANT_LISTEN_MODES.map((mode) => [mode, serializeStats(byMode.get(mode))])) as Record<WantListenMode, ReturnType<typeof serializeStats>>
  const totalQuestions = rows.reduce((sum, row) => sum + row.totalQuestions, 0)
  const totalCorrect = rows.reduce((sum, row) => sum + row.totalCorrect, 0)
  const totalGames = rows.reduce((sum, row) => sum + row.gamesPlayed, 0)
  const skilledMode = WANT_LISTEN_MODES
    .map((mode) => ({ mode, rate: modeStats[mode].accuracy, best: modeStats[mode].bestScore }))
    .sort((left, right) => right.rate - left.rate || right.best - left.best)[0]
  return {
    config,
    modes: modeStats,
    total: {
      gamesPlayed: totalGames,
      totalQuestions,
      totalCorrect,
      accuracy: totalQuestions ? Math.round((totalCorrect / totalQuestions) * 1000) / 10 : 0,
      bestMode: totalQuestions ? skilledMode.mode : null,
    },
    activeSessions: Array.from(latestActiveByMode.values()).map((session) => ({ ...session, expiresAt: session.expiresAt.toISOString() })),
    statsUnavailable: !statsRead.available,
    activeSessionsUnavailable: !activeRead.available,
  }
}

export async function getWantListenCoverage() {
  const songs = (await loadSongRows()).map(mapSong)
  const validWantListen = songs.filter(isValidWantListenSong)
  const cantoneseWithLyrics = songs.filter((song) => {
    const lines = cleanLyrics(song.lyrics)
    return normalizeRatingLanguage(effectiveSongLanguage(song)) === 'CANTONESE' && Boolean(selectLyricFragment(lines, 1))
  })
  return {
    totalPublishedSongs: songs.length,
    wantListenEligibleSongs: validWantListen.length,
    withReleaseYear: songs.filter((song) => Boolean(effectiveSongYear(song))).length,
    withAlbum: songs.filter((song) => Boolean(song.album.id && song.album.name)).length,
    withAlbumCover: songs.filter((song) => Boolean(song.album.coverUrl)).length,
    withCredits: songs.filter((song) => Boolean(song.lyricist?.trim() || song.composer?.trim())).length,
    withValidLyrics: songs.filter((song) => cleanLyrics(song.lyrics).length > 0).length,
    withSafeLyricSnippet: songs.filter((song) => Boolean(selectSafeLyricSnippet(cleanLyrics(song.lyrics), song.title))).length,
    cantoneseWithValidLyrics: cantoneseWithLyrics.length,
  }
}

export { validateQuestion } from '@/lib/want-listen-questions'
export { WANT_LISTEN_SETTING_KEYS }
