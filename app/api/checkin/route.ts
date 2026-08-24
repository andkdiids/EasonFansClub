import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { syncUserAchievements } from '@/lib/achievements'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, formatBeijingDate, getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { CUSTOM_MOOD_BANNED_WORD_MESSAGE, CUSTOM_MOOD_INVALID_MESSAGE, CUSTOM_MOOD_TYPE, PRESET_MOOD_TYPE, normalizeCustomMoodText, validateCustomMoodInput } from '@/lib/checkin-mood'
import { getCheckInMessage, invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { getTodayCheckInCount } from '@/lib/checkin-stats'
import { getMood, getStreakBonus } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
import { awardExperience, EXPERIENCE_REWARD_SOURCES, getRandomCheckInExperience } from '@/lib/growth'
import { getRandomCheckInPoints } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { enforceApiRateLimit, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'

const SLOW_CHECKIN_REQUEST_MS = 1000

function getCheckInRequestId(request: Request) {
  const provided = request.headers.get('x-request-id')?.trim()
  return provided && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(provided)
    ? provided
    : randomUUID()
}

function serializeCheckInError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack?.split('\n').slice(0, 3).join('\n') }
  return { message: String(error) }
}

function logCheckInPostProcessError(input: { requestId: string; userId: string; phase: string; error: unknown }) {
  console.error('[checkin.post_process_failed]', {
    route: '/api/checkin',
    method: 'POST',
    requestId: input.requestId,
    userId: input.userId,
    phase: input.phase,
    error: serializeCheckInError(input.error),
  })
}

async function runCheckInPostProcess(input: {
  requestId: string
  userId: string
  checkInId: string
  dailyMessageId: string | null
  todayKey: string
  today: Date
  ipLocation: Parameters<typeof updateUserIpRegion>[1]
  mood: string | null
  moodType: string | null
  moodEmoji: string | null
  moodText: string | null
  message: string
}) {
  const jobs: Array<{ phase: string; run: () => Promise<unknown> | unknown }> = [
    {
      phase: 'ipRegion',
      run: () => updateUserIpRegion(input.userId, input.ipLocation),
    },
    {
      phase: 'friendActivity',
      run: () => prisma.friendActivity.create({
        data: {
          actorId: input.userId,
          type: 'CHECKIN',
          checkInId: input.checkInId,
          dailyMessageId: input.dailyMessageId,
          mood: input.mood,
          moodType: input.moodType,
          moodEmoji: input.moodEmoji,
          moodText: input.moodText,
          content: input.message || null,
          targetUrl: `/checkin?date=${input.todayKey}${input.dailyMessageId ? `&message=${input.dailyMessageId}` : ''}`,
        },
      }),
    },
    {
      phase: 'achievements',
      run: () => syncUserAchievements(input.userId, ['CHECKIN_STREAK', 'CHECKIN_TOTAL']),
    },
    {
      phase: 'dailyTaskProgress',
      run: async () => {
        const signTask = await prisma.dailyTaskTemplate.findUnique({
          where: { key: 'daily-checkin' },
          select: { id: true },
        })
        if (!signTask) return null
        return prisma.dailyTaskProgress.upsert({
          where: {
            userId_templateId_taskDate: {
              userId: input.userId,
              templateId: signTask.id,
              taskDate: input.today,
            },
          },
          update: {
            progress: 1,
            isCompleted: true,
            completedAt: new Date(),
          },
          create: {
            userId: input.userId,
            templateId: signTask.id,
            taskDate: input.today,
            progress: 1,
            isCompleted: true,
            completedAt: new Date(),
          },
        })
      },
    },
    {
      phase: 'badgeEvaluation',
      run: () => triggerBadgeEvaluation(input.userId, 'CHECKIN_CREATED'),
    },
  ]

  const results = await Promise.allSettled(jobs.map((job) => Promise.resolve().then(job.run)))
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logCheckInPostProcessError({
        requestId: input.requestId,
        userId: input.userId,
        phase: jobs[index].phase,
        error: result.reason,
      })
    }
  })
}

function logSlowCheckIn(input: {
  requestId: string
  userId: string
  totalMs: number
  authMs: number
  precheckMs: number
  transactionMs: number
  postProcessMs: number
}) {
  if (input.totalMs <= SLOW_CHECKIN_REQUEST_MS) return
  console.warn('[checkin.performance]', {
    route: '/api/checkin',
    method: 'POST',
    ...input,
  })
}

function logSlowCheckInPostProcess(input: { requestId: string; userId: string; postProcessMs: number }) {
  if (input.postProcessMs <= SLOW_CHECKIN_REQUEST_MS) return
  console.warn('[checkin.post_process.performance]', {
    route: '/api/checkin',
    method: 'POST',
    ...input,
  })
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/checkin',
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey()
  const [profile, todayCheckIn, todayCount, history] = await Promise.all([
    safeDb(
      'User.findUnique checkinApi.profile',
      prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, experience: true, level: true, checkinMoodEnabled: true },
      }),
      null,
    ),
    withDbTimeout(
      'CheckIn.findUnique checkinApi.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } },
        select: { checkDate: true, points: true, exp: true, mood: true, moodType: true, moodEmoji: true, moodText: true, message: true, streakDay: true, createdAt: true },
      }),
      8000,
    ),
    getTodayCheckInCount(todayKey),
    safeDb('CheckIn.findMany checkinApi.history', prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } }), []),
  ])

  if (!profile) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const streaks = calculateCheckinStreaks(history.map((item) => item.checkinDateKey))
  return NextResponse.json({
    checkedToday: Boolean(todayCheckIn),
    todayCheckIn,
    consecutiveDays: streaks.currentStreak,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    totalCheckIns: streaks.totalDays,
    totalDays: streaks.totalDays,
    points: profile.points,
    exp: profile.exp,
    experience: profile.experience,
    level: profile.level,
    todayCount,
    checkinMoodEnabled: profile.checkinMoodEnabled,
    todayValue: formatBeijingDate(today),
  })
}

export async function POST(request: Request) {
  const requestId = getCheckInRequestId(request)
  const routeStartedAt = Date.now()
  const authStartedAt = Date.now()
  const user = await getCurrentUser()
  const authMs = Date.now() - authStartedAt
  if (!user) return NextResponse.json({ message: '请先登录后再挂号' }, { status: 401 })
  const precheckStartedAt = Date.now()
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/checkin',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 5, windowSeconds: 60 },
  }, '挂号请求过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const requestedMoodType = body?.moodType === CUSTOM_MOOD_TYPE ? CUSTOM_MOOD_TYPE : PRESET_MOOD_TYPE
  const moodKey = sanitizeText(body?.moodKey ?? body?.mood, 40)
  const requestedMood = requestedMoodType === CUSTOM_MOOD_TYPE ? undefined : getMood(moodKey)
  const customMoodValidation = requestedMoodType === CUSTOM_MOOD_TYPE
    ? validateCustomMoodInput({
        emoji: body?.moodEmoji,
        text: typeof body?.moodText === 'string'
          ? normalizeCustomMoodText(sanitizeText(body.moodText, 100))
          : body?.moodText,
      })
    : null
  if (customMoodValidation && !customMoodValidation.ok) {
    return NextResponse.json({ message: CUSTOM_MOOD_INVALID_MESSAGE }, { status: 400 })
  }
  const validatedCustomMood = customMoodValidation?.ok ? customMoodValidation : null
  if (validatedCustomMood && (await checkBannedWords(validatedCustomMood.text)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: CUSTOM_MOOD_BANNED_WORD_MESSAGE }, { status: 400 })
  }
  const preference = await prisma.user.findUnique({ where: { id: user.id }, select: { checkinMoodEnabled: true } })
  if (!preference) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const mood = preference.checkinMoodEnabled ? requestedMood : null
  const customMood = preference.checkinMoodEnabled ? validatedCustomMood : null
  const rawMessage = sanitizeText(body?.message, 300)
  if ((await checkBannedWords(rawMessage)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }
  const message = rawMessage
  const ipLocation = await resolveIpLocation(request)
  const ipRegion = ipLocation?.label || null

  if (preference.checkinMoodEnabled && !mood && !customMood) {
    return NextResponse.json({ message: '请选择今日心情' }, { status: 400 })
  }

  const checkedAt = new Date()
  const today = startOfLocalDay(checkedAt)
  const todayKey = getShanghaiDateKey(checkedAt)

  const existing = await prisma.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } },
    select: { checkDate: true, points: true, exp: true, mood: true, moodType: true, moodEmoji: true, moodText: true, message: true, streakDay: true, createdAt: true },
  })
  if (existing) {
    const [profile, history] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, experience: true, level: true },
      }),
      prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } }),
    ])
    // 与 GET 同一口径:连续天数只按签到记录重算,不读 User.consecutiveDays / CheckIn.streakDay 快照
    const streaks = calculateCheckinStreaks(history.map((item) => item.checkinDateKey))
    return NextResponse.json({
      message: '今天已经挂号过了',
      checkedToday: true,
      checkDate: formatBeijingDate(today),
      todayCheckIn: existing,
      consecutiveDays: streaks.currentStreak,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      points: profile?.points ?? 0,
      exp: profile?.exp ?? 0,
      experience: profile?.experience ?? 0,
      level: profile?.level ?? 1,
      gainedPoints: 0,
      gainedExp: 0,
      created: false,
    })
  }

  const precheckMs = Date.now() - precheckStartedAt
  const transactionStartedAt = Date.now()
  let result
  try {
    result = await prisma.$transaction(async (tx) => {
    // 不再链式读取昨日记录的连签数加一;按全部签到记录(含今日)统一重算
    const existingKeys = await tx.checkIn.findMany({
      where: { userId: user.id },
      select: { checkinDateKey: true },
    })
    const streaks = calculateCheckinStreaks([...existingKeys.map((item) => item.checkinDateKey), todayKey], checkedAt)
    const nextStreak = streaks.currentStreak
    const bonus = getStreakBonus(nextStreak)
    const requestedRegistrationFee = getRandomCheckInPoints()
    const requestedExp = getRandomCheckInExperience()

    const createdCheckIn = await tx.checkIn.create({
      data: {
        userId: user.id,
        checkDate: checkedAt,
        checkinDateKey: todayKey,
        createdAt: checkedAt,
        points: 0,
        exp: 0,
        streakDay: nextStreak,
        mood: mood?.key ?? null,
        moodType: mood ? PRESET_MOOD_TYPE : customMood ? CUSTOM_MOOD_TYPE : null,
        moodEmoji: customMood?.emoji ?? null,
        moodText: customMood?.text ?? null,
        message: message || null,
      },
      select: { id: true, checkDate: true, points: true, exp: true, mood: true, moodType: true, moodEmoji: true, moodText: true, message: true, streakDay: true, createdAt: true },
    })
    const ordinaryFeeAward = await awardRegistrationFee(tx, {
      userId: user.id,
      requestedAmount: requestedRegistrationFee,
      action: 'DAILY_CHECK_IN',
      reason: '每日挂号',
      businessKey: `checkin:${createdCheckIn.id}`,
      checkInId: createdCheckIn.id,
      now: checkedAt,
    })
    const streakFeeAward = bonus
      ? await awardRegistrationFee(tx, {
          userId: user.id,
          requestedAmount: bonus.points,
          action: 'CONTINUOUS_CHECK_IN_BONUS',
          reason: bonus.label,
          businessKey: `checkin-streak:${createdCheckIn.id}`,
          checkInId: createdCheckIn.id,
          now: checkedAt,
        })
      : null
    const gainedPoints = ordinaryFeeAward.awardedAmount + (streakFeeAward?.awardedAmount || 0)
    const expAward = await awardExperience(tx, {
      userId: user.id,
      amount: requestedExp,
      type: 'CHECKIN',
      description: '每日挂号',
      sourceType: EXPERIENCE_REWARD_SOURCES.CHECK_IN,
      sourceId: createdCheckIn.id,
    })
    const gainedExp = expAward.amount
    const checkIn = await tx.checkIn.update({
      where: { id: createdCheckIn.id },
      data: { points: gainedPoints, exp: gainedExp },
      select: { id: true, checkDate: true, points: true, exp: true, mood: true, moodType: true, moodEmoji: true, moodText: true, message: true, streakDay: true, createdAt: true },
    })
    let dailyMessageId: string | null = null
    if (message) {
      const dailyMessage = await tx.dailyMessage.create({
        data: {
          userId: user.id,
          checkInId: checkIn.id,
          date: today,
          mood: mood?.key ?? null,
          moodType: mood ? PRESET_MOOD_TYPE : customMood ? CUSTOM_MOOD_TYPE : null,
          moodEmoji: customMood?.emoji ?? null,
          moodText: customMood?.text ?? null,
          content: message,
          ipRegion,
        },
        select: { id: true },
      })
      dailyMessageId = dailyMessage.id
    }

    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        consecutiveDays: nextStreak,
        lastCheckInDate: today,
      },
      select: { points: true, exp: true, experience: true, consecutiveDays: true, level: true },
    })

    return {
      user: updatedUser,
      checkIn,
      gainedPoints: checkIn.points,
      gainedExp: checkIn.exp,
      bonus,
      ordinaryRegistrationFee: ordinaryFeeAward.awardedAmount,
      streakBonusRegistrationFee: streakFeeAward?.awardedAmount || 0,
      dailyMessageId,
      streaks,
    }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const [todayCheckIn, profile, history] = await Promise.all([
        prisma.checkIn.findUnique({ where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } } }),
        prisma.user.findUnique({ where: { id: user.id }, select: { points: true, exp: true, experience: true, level: true } }),
        prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } }),
      ])
      // 并发冲突时同样按签到记录重算,保证与其它分支同一口径
      const streaks = calculateCheckinStreaks(history.map((item) => item.checkinDateKey))
      return NextResponse.json({
        message: '今日已挂号', checkedToday: true, checkDate: todayKey, todayCheckIn,
        consecutiveDays: streaks.currentStreak,
        currentStreak: streaks.currentStreak,
        longestStreak: streaks.longestStreak,
        points: profile?.points ?? 0, exp: profile?.exp ?? 0, experience: profile?.experience ?? 0,
        level: profile?.level ?? 1, gainedPoints: 0, gainedExp: 0, created: false,
      })
    }
    throw error
  }

  const transactionMs = Date.now() - transactionStartedAt
  const postProcessStartedAt = Date.now()
  invalidateCheckInMessagesCache()
  invalidateHomeDataCache()
  const createdMessage = result.dailyMessageId
    ? await getCheckInMessage({
        messageId: result.dailyMessageId,
        selectedDate: today,
        nextDate: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        viewerId: user.id,
        viewerCanModerate: user.role === 'ADMIN' || user.role === 'SUPER_ADMIN',
      }).catch((error) => {
        logCheckInPostProcessError({ requestId, userId: user.id, phase: 'dailyMessageResponse', error })
        return null
      })
    : null

  const backgroundPostProcessStartedAt = Date.now()
  void runCheckInPostProcess({
    requestId,
    userId: user.id,
    checkInId: result.checkIn.id,
    dailyMessageId: result.dailyMessageId,
    todayKey,
    today,
    ipLocation,
    mood: mood?.key ?? null,
    moodType: mood ? PRESET_MOOD_TYPE : customMood ? CUSTOM_MOOD_TYPE : null,
    moodEmoji: customMood?.emoji ?? null,
    moodText: customMood?.text ?? null,
    message,
  }).catch((error) => {
    logCheckInPostProcessError({ requestId, userId: user.id, phase: 'postProcessCoordinator', error })
  }).finally(() => {
    logSlowCheckInPostProcess({
      requestId,
      userId: user.id,
      postProcessMs: Date.now() - backgroundPostProcessStartedAt,
    })
  })

  const postProcessMs = Date.now() - postProcessStartedAt
  const totalMs = Date.now() - routeStartedAt
  logSlowCheckIn({ requestId, userId: user.id, totalMs, authMs, precheckMs, transactionMs, postProcessMs })

  return NextResponse.json({
    message: '今日挂号成功',
    checkedToday: true,
    checkDate: formatBeijingDate(today),
    todayCheckIn: result.checkIn,
    mood,
    gainedPoints: result.checkIn.points,
    gainedExp: result.checkIn.exp,
    bonus: result.bonus,
    ordinaryRegistrationFee: result.ordinaryRegistrationFee,
    streakBonusRegistrationFee: result.streakBonusRegistrationFee,
    dailyMessageId: result.dailyMessageId,
    dailyMessage: createdMessage,
    consecutiveDays: result.streaks.currentStreak,
    currentStreak: result.streaks.currentStreak,
    longestStreak: result.streaks.longestStreak,
    points: result.user.points,
    exp: result.user.exp,
    experience: result.user.experience,
    level: result.user.level,
    created: true,
  })
}
