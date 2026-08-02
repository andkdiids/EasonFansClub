import { randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { createGuessSongSignedUrl, getGuessSongSignedUrlExpires } from '@/lib/guess-song-storage'
import { prisma } from '@/lib/prisma'
import { createUUID } from '@/lib/utils/uuid'

export const EHOSPITAL_CONFIG_ID = 'global'
export const EHOSPITAL_AUDIO_SECONDS = 7
export const EHOSPITAL_SESSION_MINUTES = 30

function logHospitalServer(event: string, details?: unknown) {
  console.info(`[ehospital][server] ${new Date().toISOString()} ${event}`, details ?? {})
}

type HospitalOption = { key: string; label: string }

type HospitalQuestionSnapshot = {
  publicId: string
  sourceQuestionId: string
  audioVariantId: string
  answerKey: string
  options: HospitalOption[]
}

type HospitalAnswerSnapshot = {
  questionId: string
  optionKey: string
  correct: boolean
  answeredAt: string
}

export class EHospitalCheckError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'EHOSPITAL_CHECK_ERROR',
  ) {
    super(message)
    this.name = 'EHospitalCheckError'
  }
}

function shuffle<T>(items: readonly T[]) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function parseQuestions(value: Prisma.JsonValue): HospitalQuestionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const publicId = typeof row.publicId === 'string' ? row.publicId : ''
    const sourceQuestionId = typeof row.sourceQuestionId === 'string' ? row.sourceQuestionId : ''
    const audioVariantId = typeof row.audioVariantId === 'string' ? row.audioVariantId : ''
    const answerKey = typeof row.answerKey === 'string' ? row.answerKey : ''
    const options = Array.isArray(row.options)
      ? row.options.flatMap((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) return []
          const candidate = option as Record<string, unknown>
          return typeof candidate.key === 'string' && typeof candidate.label === 'string'
            ? [{ key: candidate.key, label: candidate.label }]
            : []
        })
      : []
    return publicId && sourceQuestionId && audioVariantId && answerKey && options.length === 4
      ? [{ publicId, sourceQuestionId, audioVariantId, answerKey, options }]
      : []
  })
}

function parseAnswers(value: Prisma.JsonValue | null): HospitalAnswerSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return typeof row.questionId === 'string'
      && typeof row.optionKey === 'string'
      && typeof row.correct === 'boolean'
      && typeof row.answeredAt === 'string'
      ? [{ questionId: row.questionId, optionKey: row.optionKey, correct: row.correct, answeredAt: row.answeredAt }]
      : []
  })
}

function createAnswerResult(question: HospitalQuestionSnapshot, optionKey: string, correct: boolean) {
  return {
    questionId: question.publicId,
    correct,
    scoreEarned: correct ? 10 : 0,
    correctAnswer: question.options.find((option) => option.key === question.answerKey)?.label || '',
    selectedOptionKey: optionKey,
  }
}

function dayStart(now: Date) {
  const value = new Date(now)
  value.setUTCHours(0, 0, 0, 0)
  return value
}

export async function getEHospitalCheckConfig() {
  return prisma.eHospitalCheckConfig.upsert({
    where: { id: EHOSPITAL_CONFIG_ID },
    update: {},
    create: {
      id: EHOSPITAL_CONFIG_ID,
      enabled: true,
      questionCount: 10,
      audioSeconds: EHOSPITAL_AUDIO_SECONDS,
      passScore: 60,
      dailyLimit: 3,
    },
  })
}

export async function updateEHospitalCheckConfig(input: {
  enabled: boolean
  questionCount: number
  audioSeconds: number
  passScore: number
  dailyLimit: number
}) {
  if (input.questionCount < 1 || input.questionCount > 20) throw new EHospitalCheckError('题目数量需要在 1-20 之间', 400, 'CONFIG_INVALID')
  if (input.audioSeconds !== EHOSPITAL_AUDIO_SECONDS) throw new EHospitalCheckError('E院体检只能使用固定 7 秒音频', 400, 'CONFIG_AUDIO_SECONDS_FIXED')
  if (input.passScore < 0 || input.passScore > input.questionCount * 10) throw new EHospitalCheckError('通过分数范围不正确', 400, 'CONFIG_PASS_SCORE_INVALID')
  if (input.dailyLimit < 1 || input.dailyLimit > 20) throw new EHospitalCheckError('每日次数需要在 1-20 之间', 400, 'CONFIG_DAILY_LIMIT_INVALID')
  return prisma.eHospitalCheckConfig.upsert({
    where: { id: EHOSPITAL_CONFIG_ID },
    update: input,
    create: { id: EHOSPITAL_CONFIG_ID, ...input },
  })
}

async function ensureRegisterCheckVariants() {
  const gameVariants = await prisma.guessSongAudioVariant.findMany({
    where: {
      durationSeconds: EHOSPITAL_AUDIO_SECONDS,
      purpose: 'GAME',
      GuessSongQuestion: {
        enabled: true,
        processingStatus: 'READY',
        MusicSong: { MusicAlbum: { status: 'PUBLISHED' } },
      },
    },
    select: { questionId: true, durationSeconds: true, storagePath: true, fileSize: true },
  })

  logHospitalServer('ensureRegisterCheckVariants GAME variants loaded', { count: gameVariants.length })

  await Promise.all(gameVariants.map((variant) => prisma.guessSongAudioVariant.upsert({
    where: {
      questionId_durationSeconds_purpose: {
        questionId: variant.questionId,
        durationSeconds: variant.durationSeconds,
        purpose: 'REGISTER_CHECK',
      },
    },
    update: {},
    create: {
      questionId: variant.questionId,
      durationSeconds: variant.durationSeconds,
      storagePath: variant.storagePath,
      fileSize: variant.fileSize,
      purpose: 'REGISTER_CHECK',
    },
  })))

  logHospitalServer('ensureRegisterCheckVariants REGISTER_CHECK writes finished', { count: gameVariants.length })
}

async function loadQuestionPool() {
  const rows = await prisma.guessSongQuestion.findMany({
    where: {
      enabled: true,
      processingStatus: 'READY',
      MusicSong: { MusicAlbum: { status: 'PUBLISHED' } },
      GuessSongAudioVariant: {
        some: { durationSeconds: EHOSPITAL_AUDIO_SECONDS, purpose: 'REGISTER_CHECK' },
      },
    },
    select: {
      id: true,
      songTitle: true,
      MusicSong: { select: { id: true, title: true, artist: true, albumId: true } },
      GuessSongAudioVariant: {
        where: { durationSeconds: EHOSPITAL_AUDIO_SECONDS, purpose: 'REGISTER_CHECK' },
        select: { id: true, storagePath: true },
        take: 1,
      },
    },
    take: 2000,
  })

  return rows.flatMap((row) => {
    const song = row.MusicSong
    const variant = row.GuessSongAudioVariant[0]
    return song && variant
      ? [{
          questionId: row.id,
          song: { id: song.id, title: song.title || row.songTitle, artist: song.artist, albumId: song.albumId },
          variant,
        }]
      : []
  })
}

function createQuestionSnapshot(
  question: Awaited<ReturnType<typeof loadQuestionPool>>[number],
  songs: Awaited<ReturnType<typeof loadQuestionPool>>[number]['song'][],
) {
  const usedTitles = new Set<string>([question.song.title.trim().toLocaleLowerCase('zh-CN')])
  const sameArtist = songs.filter((song) => song.id !== question.song.id && song.artist === question.song.artist)
  const otherSongs = songs.filter((song) => song.id !== question.song.id && song.artist !== question.song.artist)
  const distractors = shuffle([...sameArtist, ...otherSongs]).filter((song) => {
    const key = song.title.trim().toLocaleLowerCase('zh-CN')
    if (!key || usedTitles.has(key)) return false
    usedTitles.add(key)
    return true
  }).slice(0, 3)

  if (distractors.length < 3) {
    throw new EHospitalCheckError('可用歌曲不足，暂时无法开始体检', 409, 'QUESTION_POOL_INSUFFICIENT')
  }

  const options = shuffle([
    { label: question.song.title, correct: true },
    ...distractors.map((song) => ({ label: song.title, correct: false })),
  ]).map((option) => ({ key: createUUID(), label: option.label, correct: option.correct }))
  const answerKey = options.find((option) => option.correct)?.key
  if (!answerKey) throw new EHospitalCheckError('体检题目生成失败', 500, 'QUESTION_BUILD_FAILED')

  return {
    publicId: createUUID(),
    sourceQuestionId: question.questionId,
    audioVariantId: question.variant.id,
    answerKey,
    options: options.map(({ key, label }) => ({ key, label })),
  } satisfies HospitalQuestionSnapshot
}

async function countAttempts(identityHash: string, now: Date) {
  return prisma.eHospitalCheckAttempt.count({
    where: { identityHash, createdAt: { gte: dayStart(now) } },
  })
}

async function getDraft(tokenHash: string) {
  const draft = await prisma.registrationDraft.findUnique({ where: { tokenHash } })
  if (!draft) throw new EHospitalCheckError('注册验证已失效，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_NOT_FOUND')
  if (draft.completedAt) throw new EHospitalCheckError('该注册验证已经使用过', 409, 'REGISTRATION_DRAFT_COMPLETED')
  if (draft.expiresAt <= new Date()) throw new EHospitalCheckError('注册验证已过期，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_EXPIRED')
  return draft
}

async function buildPublicState(
  session: Awaited<ReturnType<typeof prisma.eHospitalCheckSession.findUniqueOrThrow>>,
  config: Awaited<ReturnType<typeof getEHospitalCheckConfig>>,
  now: Date,
) {
  let status = session.status
  if (status === 'STARTED' && session.expiresAt <= now) {
    await prisma.eHospitalCheckSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } })
    status = 'EXPIRED'
  }

  const questions = parseQuestions(session.questions)
  const answers = parseAnswers(session.answers)
  const current = status === 'STARTED' && answers.length < questions.length ? questions[answers.length] : null
  let question: { questionId: string; audioUrl: string; options: HospitalOption[]; audioSeconds: number } | null = null
  if (current) {
    const variant = await prisma.guessSongAudioVariant.findUnique({
      where: { id: current.audioVariantId },
      select: { storagePath: true, durationSeconds: true, purpose: true },
    })
    if (!variant || variant.purpose !== 'REGISTER_CHECK' || variant.durationSeconds !== EHOSPITAL_AUDIO_SECONDS) {
      throw new EHospitalCheckError('体检音频暂不可用，请稍后再试', 503, 'REGISTER_AUDIO_MISSING')
    }
    const expiresIn = getGuessSongSignedUrlExpires()
    question = {
      questionId: current.publicId,
      audioUrl: await createGuessSongSignedUrl(variant.storagePath, expiresIn),
      options: current.options,
      audioSeconds: EHOSPITAL_AUDIO_SECONDS,
    }
  }

  const remainingAttempts = Math.max(0, config.dailyLimit - await countAttempts(
    (await prisma.registrationDraft.findUniqueOrThrow({ where: { id: session.registrationDraftId }, select: { identityHash: true } })).identityHash,
    now,
  ))

  return {
    sessionId: session.id,
    status,
    expiresAt: session.expiresAt.toISOString(),
    currentPosition: Math.min(answers.length + 1, questions.length),
    totalQuestions: questions.length,
    audioSeconds: EHOSPITAL_AUDIO_SECONDS,
    score: session.score ?? answers.filter((answer) => answer.correct).length * 10,
    correctCount: answers.filter((answer) => answer.correct).length,
    answeredCount: answers.length,
    remainingAttempts,
    question,
  }
}

export async function startEHospitalCheck(input: {
  draftTokenHash: string
  ip: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  logHospitalServer('startEHospitalCheck entered', { at: now.toISOString() })
  const draft = await getDraft(input.draftTokenHash)
  const config = await getEHospitalCheckConfig()
  logHospitalServer('EHospitalCheckConfig loaded', {
    enabled: config.enabled,
    questionCount: config.questionCount,
    audioSeconds: config.audioSeconds,
    passScore: config.passScore,
    dailyLimit: config.dailyLimit,
  })
  if (!config.enabled) throw new EHospitalCheckError('E院体检当前未开放', 403, 'EHOSPITAL_CHECK_DISABLED')
  if (config.audioSeconds !== EHOSPITAL_AUDIO_SECONDS) {
    throw new EHospitalCheckError('体检音频配置必须为 7 秒', 409, 'EHOSPITAL_AUDIO_CONFIG_INVALID')
  }

  const active = await prisma.eHospitalCheckSession.findFirst({
    where: { registrationDraftId: draft.id, status: 'STARTED' },
    orderBy: { createdAt: 'desc' },
  })
  if (active && active.expiresAt > now) return buildPublicState(active, config, now)
  if (active) await prisma.eHospitalCheckSession.update({ where: { id: active.id }, data: { status: 'EXPIRED' } })

  const used = await countAttempts(draft.identityHash, now)
  if (used >= config.dailyLimit) {
    throw new EHospitalCheckError('今日体检次数已用完，请明日再次参加。', 429, 'DAILY_LIMIT_REACHED')
  }

  const ensureStartedAt = Date.now()
  logHospitalServer('ensureRegisterCheckVariants started')
  await ensureRegisterCheckVariants()
  logHospitalServer('ensureRegisterCheckVariants finished', { elapsedMs: Date.now() - ensureStartedAt })
  const pool = await loadQuestionPool()
  if (pool.length < config.questionCount || pool.length < 4) {
    throw new EHospitalCheckError('可用体检题目不足，请联系管理员补充已发布歌曲音频', 409, 'QUESTION_POOL_INSUFFICIENT')
  }
  const selected = shuffle(pool).slice(0, config.questionCount)
  const snapshots = selected.map((question) => createQuestionSnapshot(question, pool.map((item) => item.song)))
  const session = await prisma.eHospitalCheckSession.create({
    data: {
      registrationDraftId: draft.id,
      questions: snapshots,
      answers: [],
      status: 'STARTED',
      expiresAt: new Date(now.getTime() + EHOSPITAL_SESSION_MINUTES * 60_000),
    },
  })
  logHospitalServer('EHospitalCheckSession created', { sessionId: session.id, questionCount: snapshots.length })
  const state = await buildPublicState(session, config, now)
  logHospitalServer('startEHospitalCheck returning', {
    sessionId: state.sessionId,
    status: state.status,
    currentPosition: state.currentPosition,
    totalQuestions: state.totalQuestions,
  })
  return state
}

export async function answerEHospitalCheck(input: {
  draftTokenHash: string
  sessionId: string
  questionId: string
  optionKey: string
  ip: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const draft = await getDraft(input.draftTokenHash)
  const config = await getEHospitalCheckConfig()
  const session = await prisma.eHospitalCheckSession.findUnique({ where: { id: input.sessionId } })
  if (!session || session.registrationDraftId !== draft.id) {
    throw new EHospitalCheckError('体检场次不存在', 404, 'SESSION_NOT_FOUND')
  }
  if (session.status === 'STARTED' && session.expiresAt <= now) {
    await prisma.eHospitalCheckSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } })
    throw new EHospitalCheckError('本次体检已过期，请重新开始', 410, 'SESSION_EXPIRED')
  }
  if (session.status !== 'STARTED') throw new EHospitalCheckError('本次体检已经结束', 409, 'SESSION_FINISHED')

  const questions = parseQuestions(session.questions)
  const answers = parseAnswers(session.answers)
  const current = questions.find((question) => question.publicId === input.questionId)
  if (!current) throw new EHospitalCheckError('体检题目不存在', 404, 'QUESTION_NOT_FOUND')
  const duplicate = answers.find((answer) => answer.questionId === current.publicId)
  if (duplicate) {
    return {
      ...(await buildPublicState(session, config, now)),
      answerResult: createAnswerResult(current, duplicate.optionKey, duplicate.correct),
    }
  }
  if (answers.length !== questions.findIndex((question) => question.publicId === current.publicId)) {
    throw new EHospitalCheckError('请按题目顺序作答', 409, 'QUESTION_ORDER_INVALID')
  }
  if (!current.options.some((option) => option.key === input.optionKey)) {
    throw new EHospitalCheckError('答案选项无效', 400, 'OPTION_INVALID')
  }

  const correct = input.optionKey === current.answerKey
  const answerResult = createAnswerResult(current, input.optionKey, correct)
  const nextAnswers: HospitalAnswerSnapshot[] = [
    ...answers,
    { questionId: current.publicId, optionKey: input.optionKey, correct, answeredAt: now.toISOString() },
  ]
  const complete = nextAnswers.length >= questions.length
  const score = nextAnswers.filter((answer) => answer.correct).length * 10
  const passed = score >= config.passScore
  const nextStatus = complete ? (passed ? 'PASSED' : 'FAILED') : 'STARTED'
  const updatedCount = await prisma.eHospitalCheckSession.updateMany({
    where: { id: session.id, status: 'STARTED', updatedAt: session.updatedAt },
    data: { answers: nextAnswers, score, status: nextStatus },
  })
  if (updatedCount.count !== 1) {
    const latest = await prisma.eHospitalCheckSession.findUniqueOrThrow({ where: { id: session.id } })
    if (parseAnswers(latest.answers).some((answer) => answer.questionId === current.publicId)) return buildPublicState(latest, config, now)
    throw new EHospitalCheckError('答案提交冲突，请重试本题', 409, 'ANSWER_CONFLICT')
  }
  const updated = await prisma.eHospitalCheckSession.findUniqueOrThrow({ where: { id: session.id } })
  if (complete) {
    await prisma.eHospitalCheckAttempt.upsert({
      where: { sessionId: session.id },
      update: {},
      create: {
        sessionId: session.id,
        score,
        passed,
        ip: input.ip,
        identityHash: draft.identityHash,
        registrationDraftId: draft.id,
      },
    })
  }

  return {
    ...(await buildPublicState(updated, config, now)),
    answerResult,
  }
}

export async function getEHospitalCheckState(input: {
  draftTokenHash: string
  sessionId: string
  now?: Date
}) {
  const draft = await getDraft(input.draftTokenHash)
  const session = await prisma.eHospitalCheckSession.findUnique({ where: { id: input.sessionId } })
  if (!session || session.registrationDraftId !== draft.id) {
    throw new EHospitalCheckError('体检场次不存在', 404, 'SESSION_NOT_FOUND')
  }
  return buildPublicState(session, await getEHospitalCheckConfig(), input.now ?? new Date())
}
