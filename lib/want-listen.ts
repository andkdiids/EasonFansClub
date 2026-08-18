import { randomUUID } from 'node:crypto'
import { Prisma, type WantListenFakeTitleDifficulty, type WantListenMode } from '@prisma/client'
import { syncUserAchievements } from '@/lib/achievements'
import { normalizeRatingLanguage } from '@/lib/rating-types'
import { prisma } from '@/lib/prisma'
import { cleanLyrics, selectLyricFragment, selectSafeLyricSnippet } from '@/lib/want-listen-lyrics'
import {
  DEFAULT_WANT_LISTEN_CONFIG,
  WANT_LISTEN_MODE_LABELS,
  WANT_LISTEN_MODES,
  WANT_LISTEN_SESSION_TTL_MS,
  WANT_LISTEN_TOTAL_QUESTIONS,
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

async function prepareQuestionSet(mode: WantListenMode) {
  if (mode === 'FALSE_TITLE') {
    const realTitles = await loadRealTitles()
    if (realTitles.length < 5) throw new WantListenServiceError('当前真实曲库不足，暂时无法开始「防不胜防」。', 409, 'QUESTION_BANK_INSUFFICIENT')
    const fakes = await loadActiveFakeTitles(realTitles)
    if (!fakes.length) throw new WantListenServiceError('当前假歌名库暂时不足，请管理员补充后再试。', 409, 'FAKE_TITLE_BANK_INSUFFICIENT')
    const usedFakeIds = new Set<string>()
    const questions: PreparedQuestion[] = []
    for (let position = 1; position <= WANT_LISTEN_TOTAL_QUESTIONS; position += 1) {
      const fake = selectFakeTitle(fakes, position, usedFakeIds)
      if (!fake) throw new WantListenServiceError('当前假歌名库暂时不足，请管理员补充后再试。', 409, 'FAKE_TITLE_BANK_INSUFFICIENT')
      const question = buildFalseTitleQuestion(realTitles, fake.title, fake.difficulty)
      if (!question) throw new WantListenServiceError('当前真实曲库不足，暂时无法开始「防不胜防」。', 409, 'QUESTION_BANK_INSUFFICIENT')
      question.data.fakeTitleId = fake.id
      questions.push({ ...question, fakeTitleId: fake.id })
      usedFakeIds.add(fake.id)
    }
    return questions
  }

  const pool = await loadSongPool(mode)
  if (pool.length < 4) throw new WantListenServiceError(mode === 'WANT_LISTEN' ? '当前曲库可用歌曲不足，暂时无法开始「想听」。' : '当前粤语歌词题库不足，暂时无法开始「粤语残片」。', 409, 'QUESTION_BANK_INSUFFICIENT')
  const usedIds = new Set<string>()
  const questions: PreparedQuestion[] = []
  for (let position = 1; position <= WANT_LISTEN_TOTAL_QUESTIONS; position += 1) {
    questions.push(mode === 'WANT_LISTEN'
      ? buildQuestionForSongMode(pool, position, usedIds)
      : buildQuestionForCantoneseMode(pool, position, usedIds))
  }
  if (mode === 'CANTONESE_FRAGMENT' && (questions.length !== WANT_LISTEN_TOTAL_QUESTIONS || questions.some((question) => !validateQuestion(question.data)))) {
    throw new WantListenServiceError('当前粤语歌词题库不足，暂时无法组成完整的有效题目。', 409, 'QUESTION_BANK_INSUFFICIENT')
  }
  return questions
}

async function loadSessionRaw(userId: string, sessionId: string) {
  return prisma.wantListenSession.findFirst({
    where: { id: sessionId, userId },
    include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } },
  })
}

async function expireSessionIfNeeded(userId: string, sessionId: string, now = new Date()) {
  await prisma.wantListenSession.updateMany({
    where: { id: sessionId, userId, status: 'IN_PROGRESS', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', activeKey: null },
  })
}

function storedQuestion(question: SessionWithQuestions['WantListenSessionQuestion'][number]) {
  return question.questionData as unknown as WantListenStoredQuestion
}

async function repairCantoneseSessionQuestions(session: SessionWithQuestions): Promise<SessionWithQuestions> {
  if (session.mode !== 'CANTONESE_FRAGMENT' || session.status !== 'IN_PROGRESS') return session

  const byPosition = new Map(session.WantListenSessionQuestion.map((question) => [question.position, question]))
  const positionsToReplace: Array<{ position: number; question?: SessionWithQuestions['WantListenSessionQuestion'][number] }> = []
  for (let position = 1; position <= session.questionCount; position += 1) {
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
  totalQuestions: number
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

export async function createWantListenSession(userId: string, rawMode: unknown) {
  const mode = ensureMode(rawMode)
  const now = new Date()
  await prisma.wantListenSession.updateMany({ where: { userId, mode, status: 'IN_PROGRESS', expiresAt: { lte: now } }, data: { status: 'EXPIRED', activeKey: null } })
  const existing = await prisma.wantListenSession.findFirst({ where: { userId, mode, status: 'IN_PROGRESS', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } })
  if (existing) {
    const restored = await loadSession(userId, existing.id)
    if (!restored) throw sessionNotFound()
    return { resumed: true, session: toPublicState(restored) }
  }
  await ensureModeAvailable(mode)

  const prepared = await prepareQuestionSet(mode)
  if (prepared.length !== WANT_LISTEN_TOTAL_QUESTIONS || (mode === 'CANTONESE_FRAGMENT' && prepared.some((question) => !validateQuestion(question.data)))) {
    throw new WantListenServiceError('当前粤语歌词题库不足，暂时无法组成完整的有效题目。', 409, 'QUESTION_BANK_INSUFFICIENT')
  }
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
          questionCount: WANT_LISTEN_TOTAL_QUESTIONS,
          expiresAt: new Date(now.getTime() + WANT_LISTEN_SESSION_TTL_MS),
          WantListenSessionQuestion: {
            create: prepared.map((question, index) => ({
              publicId: randomUUID(),
              position: index + 1,
              questionData: question.data as unknown as Prisma.InputJsonValue,
              correctOptionKey: question.correctOptionKey,
            })),
          },
        },
        select: { id: true },
      })
      for (const question of prepared) {
        if (question.fakeTitleId) await database.wantListenFakeTitle.update({ where: { id: question.fakeTitleId }, data: { usageCount: { increment: 1 } } })
      }
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
  const session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  return toPublicState(session)
}

export async function requestWantListenHint(userId: string, sessionId: string) {
  await expireSessionIfNeeded(userId, sessionId)
  const session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  if (session.status !== 'IN_PROGRESS') {
    if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
    return toPublicState(session)
  }
  if (session.mode !== 'WANT_LISTEN') throw new WantListenServiceError('该模式没有逐层提示。', 400, 'HINT_NOT_AVAILABLE')
  const current = session.WantListenSessionQuestion.find((item) => item.position === session.currentQuestion)
  if (!current) throw new WantListenServiceError('当前题目不存在，请重新开始。', 409, 'QUESTION_MISSING')
  if (current.answeredAt) return toPublicState(session)
  if (current.hintLevel >= 4) return toPublicState(session)
  await prisma.wantListenSessionQuestion.updateMany({
    where: { id: current.id, answeredAt: null, hintLevel: { lt: 4 } },
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
    if (session.mode === 'WANT_LISTEN' && question.isCorrect && question.hintLevel < 4) {
      silentCurrentStreak += 1
      silentMaxStreak = Math.max(silentMaxStreak, silentCurrentStreak)
    } else if (session.mode === 'WANT_LISTEN') {
      silentCurrentStreak = 0
    }
  }
  await database.wantListenStats.upsert({
    where: { userId_mode: { userId: session.userId, mode: session.mode } },
    create: {
      userId: session.userId,
      mode: session.mode,
      gamesPlayed: 1,
      totalQuestions: session.questionCount,
      totalCorrect: finalCorrectCount,
      bestScore: finalScore,
      currentStreak,
      maxStreak,
      perfectGames: session.mode === 'CANTONESE_FRAGMENT' && finalCorrectCount === session.questionCount ? 1 : 0,
      silentCurrentStreak,
      silentMaxStreak,
    },
    update: {
      gamesPlayed: { increment: 1 },
      totalQuestions: { increment: session.questionCount },
      totalCorrect: { increment: finalCorrectCount },
      bestScore: Math.max(existing?.bestScore || 0, finalScore),
      currentStreak,
      maxStreak,
      perfectGames: { increment: session.mode === 'CANTONESE_FRAGMENT' && finalCorrectCount === session.questionCount ? 1 : 0 },
      silentCurrentStreak,
      silentMaxStreak,
    },
  })
}

export async function answerWantListenQuestion(input: { userId: string; sessionId: string; publicQuestionId: string; optionKey: string }) {
  const optionKey = input.optionKey.trim().slice(0, 100)
  if (!optionKey) throw new WantListenServiceError('请选择一个答案。', 400, 'ANSWER_INVALID')
  await expireSessionIfNeeded(input.userId, input.sessionId)
  await loadSession(input.userId, input.sessionId)
  const result = await transactionWithRetry(async (database) => {
    const session = await database.wantListenSession.findFirst({ where: { id: input.sessionId, userId: input.userId }, include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } } })
    if (!session) throw sessionNotFound()
    if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
    if (session.status === 'ABANDONED') throw new WantListenServiceError('本局游戏已退出，请重新开始。', 409, 'SESSION_ABANDONED')
    const current = session.WantListenSessionQuestion.find((question) => question.position === session.currentQuestion)
    if (!current) throw new WantListenServiceError('当前题目不存在，请重新开始。', 409, 'QUESTION_MISSING')
    if (current.publicId !== input.publicQuestionId) throw new WantListenServiceError('当前题目已变化，请刷新后继续。', 409, 'QUESTION_MISMATCH')
    if (current.answeredAt) return { duplicate: true, sessionId: session.id, questionId: current.id, finalized: session.status === 'COMPLETED' }
    const data = storedQuestion(current)
    if (!data.options?.some((option) => option.key === optionKey)) throw new WantListenServiceError('请选择当前题目中的一个选项。', 400, 'ANSWER_INVALID')
    const isCorrect = optionKey === current.correctOptionKey
    const awardedScore = isCorrect ? scoreForWantListenAnswer(session.mode, current.hintLevel) : 0
    const updatedQuestionCount = await database.wantListenSessionQuestion.updateMany({
      where: { id: current.id, answeredAt: null },
      data: { selectedOptionKey: optionKey, isCorrect, awardedScore, answeredAt: new Date() },
    })
    if (updatedQuestionCount.count !== 1) return { duplicate: true, sessionId: session.id, questionId: current.id, finalized: session.status === 'COMPLETED' }
    const finalScore = session.score + awardedScore
    const finalCorrectCount = session.correctCount + (isCorrect ? 1 : 0)
    const isFinal = session.currentQuestion >= session.questionCount
    const completedAt = isFinal ? new Date() : null
    const updated = await database.wantListenSession.update({
      where: { id: session.id },
      data: {
        score: finalScore,
        correctCount: finalCorrectCount,
        ...(isFinal
          ? { status: 'COMPLETED', completedAt, completionTimeMs: Math.max(0, (completedAt?.getTime() || Date.now()) - session.startedAt.getTime()), activeKey: null }
          : {}),
      },
      include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } },
    })
    if (isFinal) {
      await updateWantListenStats(database, session, current.id, isCorrect, current.hintLevel, finalScore, finalCorrectCount)
      await recordWantListenLeaderboard(session.id, database)
    }
    return { duplicate: false, sessionId: updated.id, questionId: current.id, finalized: isFinal }
  })
  const state = await getWantListenSessionState(input.userId, input.sessionId)
  if (result.finalized && !result.duplicate) {
    await syncUserAchievements(input.userId, ['SPECIAL']).catch((error) => console.error('[want-listen.achievements]', error))
  }
  const answerQuestion = state.question
  return {
    duplicate: result.duplicate,
    state,
    result: answerQuestion?.result || null,
    finalized: result.finalized,
  }
}

export async function nextWantListenQuestion(userId: string, sessionId: string) {
  await expireSessionIfNeeded(userId, sessionId)
  const session = await loadSession(userId, sessionId)
  if (!session) throw sessionNotFound()
  if (session.status === 'EXPIRED') throw new WantListenServiceError('本局游戏已结束，请重新开始。', 410, 'SESSION_EXPIRED')
  if (session.status === 'COMPLETED') return toPublicState(session)
  const current = session.WantListenSessionQuestion.find((question) => question.position === session.currentQuestion)
  if (!current?.answeredAt) throw new WantListenServiceError('请先提交当前题目。', 409, 'QUESTION_NOT_ANSWERED')
  if (session.currentQuestion >= session.questionCount) return toPublicState(session)
  const updated = await prisma.wantListenSession.updateMany({ where: { id: session.id, userId, status: 'IN_PROGRESS', currentQuestion: session.currentQuestion }, data: { currentQuestion: { increment: 1 } } })
  if (updated.count !== 1) return getWantListenSessionState(userId, sessionId)
  return getWantListenSessionState(userId, sessionId)
}

export async function abandonWantListenSession(userId: string, sessionId: string) {
  await prisma.wantListenSession.updateMany({ where: { id: sessionId, userId, status: 'IN_PROGRESS' }, data: { status: 'ABANDONED', activeKey: null } })
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

export async function getWantListenSummary(userId: string) {
  const now = new Date()
  await prisma.wantListenSession.updateMany({ where: { userId, status: 'IN_PROGRESS', expiresAt: { lte: now } }, data: { status: 'EXPIRED', activeKey: null } })
  const [config, rows, active] = await Promise.all([
    getWantListenConfig(),
    prisma.wantListenStats.findMany({ where: { userId }, select: { mode: true, gamesPlayed: true, totalQuestions: true, totalCorrect: true, bestScore: true, currentStreak: true, maxStreak: true, perfectGames: true, silentCurrentStreak: true, silentMaxStreak: true } }),
    prisma.wantListenSession.findMany({ where: { userId, status: 'IN_PROGRESS' }, orderBy: { updatedAt: 'desc' }, select: { id: true, mode: true, currentQuestion: true, score: true, correctCount: true, expiresAt: true } }),
  ])
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
    activeSessions: active.map((session) => ({ ...session, expiresAt: session.expiresAt.toISOString() })),
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
