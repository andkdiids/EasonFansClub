import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, formatBeijingDate, getShanghaiDateKey, isSameLocalDay, startOfLocalDay } from '@/lib/checkin'
import { CHECK_IN_POINTS, getMood, getStreakBonus } from '@/lib/daily'
import { safeDb } from '@/lib/db-timeout'
import { awardExperience, getRandomCheckInExperience } from '@/lib/growth'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'

function logPerf(metric: string, start: number, extra?: Record<string, unknown>) {
  console.info('[perf]', { metric, ms: Date.now() - start, ...extra })
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey()
  console.log('[checkin-time]', {
  now: new Date(),
  today,
  todayKey,
})
  const [profile, todayCheckIn, todayCount, moodStats, history] = await Promise.all([
    safeDb(
      'User.findUnique checkinApi.profile',
      prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, experience: true, level: true, consecutiveDays: true, lastCheckInDate: true },
      }),
      null,
    ),
    safeDb(
      'CheckIn.findUnique checkinApi.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } },
        select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
      }),
      null,
    ),
    safeDb('CheckIn.count checkinApi.todayCount', prisma.checkIn.count({ where: { checkinDateKey: todayKey } }), 0),
    safeDb(
      'CheckIn.groupBy checkinApi.moodStats',
      prisma.checkIn.groupBy({
        by: ['mood'],
        where: { checkinDateKey: todayKey, mood: { not: null } },
        _count: { mood: true },
      }),
      [],
    ),
    safeDb('CheckIn.findMany checkinApi.history', prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } }), []),
  ])

  if (!profile) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const streaks = calculateCheckinStreaks(history.map((item) => item.checkinDateKey))
  const resolvedTodayCheckIn = todayCheckIn || (isSameLocalDay(profile.lastCheckInDate, today)
    ? { checkDate: today, points: 0, exp: 0, mood: null, message: null, streakDay: streaks.currentStreak, createdAt: profile.lastCheckInDate || today }
    : null)
  return NextResponse.json({
    checkedToday: Boolean(resolvedTodayCheckIn),
    todayCheckIn: resolvedTodayCheckIn,
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
    moodStats,
    todayValue: formatBeijingDate(today),
  })
}

export async function POST(request: Request) {
  const requestStart = Date.now()
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再挂号' }, { status: 401 })
  logPerf('checkin.auth.ms', requestStart, { userId: user.id })

  const body = await request.json().catch(() => null)
  const moodKey = sanitizeText(body?.mood, 40)
  const mood = getMood(moodKey)
  const rawMessage = sanitizeText(body?.message, 300)
  if (await containsSensitiveContent(rawMessage)) {
    return NextResponse.json({ message: '留言包含违禁词，无法发布' }, { status: 400 })
  }
  const message = rawMessage

  if (!mood) {
    return NextResponse.json({ message: '请选择今日心情' }, { status: 400 })
  }

  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey()

  const existingStart = Date.now()
  const existing = await prisma.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } },
    select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
  })
  logPerf('checkin.existing.ms', existingStart, { userId: user.id })

  if (existing) {
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { points: true, exp: true, experience: true, level: true, consecutiveDays: true },
    })
    return NextResponse.json({
      message: '今天已经挂号过了',
      checkedToday: true,
      checkDate: formatBeijingDate(today),
      todayCheckIn: existing,
      consecutiveDays: profile?.consecutiveDays ?? existing.streakDay,
      points: profile?.points ?? 0,
      exp: profile?.exp ?? 0,
      experience: profile?.experience ?? 0,
      level: profile?.level ?? 1,
      gainedPoints: 0,
      gainedExp: 0,
      created: false,
    })
  }

  const transactionStart = Date.now()
  let result
  try {
    result = await prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { points: true },
    })
    const history = await tx.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } })
    const nextStreak = calculateCheckinStreaks(history.map((item) => item.checkinDateKey)).currentStreak + 1
    const bonus = getStreakBonus(nextStreak)
    const gainedPoints = CHECK_IN_POINTS + (bonus?.points || 0)
    const requestedExp = getRandomCheckInExperience()
    const nextPoints = currentUser.points + gainedPoints

    const createdCheckIn = await tx.checkIn.create({
      data: {
        userId: user.id,
        checkDate: today,
        checkinDateKey: todayKey,
        points: gainedPoints,
        exp: 0,
        streakDay: nextStreak,
        mood: mood.key,
        message: message || null,
      },
      select: { id: true, checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
    })
    const expAward = await awardExperience(tx, {
      userId: user.id,
      amount: requestedExp,
      type: 'CHECKIN',
      description: '每日挂号',
      sourceType: 'DAILY_CHECKIN',
      sourceId: createdCheckIn.id,
    })
    const gainedExp = expAward.amount
    const checkIn = await tx.checkIn.update({
      where: { id: createdCheckIn.id },
      data: { exp: gainedExp },
      select: { id: true, checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
    })

    let dailyMessageId: string | null = null
    if (message) {
      const dailyMessage = await tx.dailyMessage.create({
        data: {
          userId: user.id,
          checkInId: checkIn.id,
          date: today,
          mood: mood.key,
          content: message,
        },
        select: { id: true },
      })
      dailyMessageId = dailyMessage.id
    }

    await tx.friendActivity.create({
      data: {
        actorId: user.id,
        checkInId: checkIn.id,
        dailyMessageId,
        mood: mood.key,
        content: message || null,
      },
    })

    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        points: nextPoints,
        consecutiveDays: nextStreak,
        lastCheckInDate: today,
      },
      select: { points: true, exp: true, experience: true, consecutiveDays: true, level: true },
    })

    await tx.pointLog.create({
      data: {
        userId: user.id,
        action: 'DAILY_CHECK_IN',
        points: gainedPoints,
        before: currentUser.points,
        after: nextPoints,
        checkInId: checkIn.id,
        reason: bonus ? `每日挂号，${bonus.label}` : '每日挂号',
      },
    })

    return { user: updatedUser, checkIn, gainedPoints, gainedExp, requestedExp, bonus, dailyMessageId }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const [todayCheckIn, profile] = await Promise.all([
        prisma.checkIn.findUnique({ where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } } }),
        prisma.user.findUnique({ where: { id: user.id }, select: { points: true, exp: true, experience: true, level: true, consecutiveDays: true } }),
      ])
      return NextResponse.json({
        message: '今日已挂号', checkedToday: true, checkDate: todayKey, todayCheckIn,
        consecutiveDays: profile?.consecutiveDays ?? todayCheckIn?.streakDay ?? 0,
        points: profile?.points ?? 0, exp: profile?.exp ?? 0, experience: profile?.experience ?? 0,
        level: profile?.level ?? 1, gainedPoints: 0, gainedExp: 0, created: false,
      })
    }
    throw error
  }
  logPerf('checkin.transaction.ms', transactionStart, { userId: user.id })

  const afterStart = Date.now()
  Promise.allSettled([
    syncUserAchievements(user.id, ['CHECKIN_STREAK', 'CHECKIN_TOTAL']),
    prisma.dailyTaskTemplate.findUnique({ where: { key: 'daily-checkin' }, select: { id: true } }).then((signTask) => (
      signTask
        ? prisma.dailyTaskProgress.upsert({
            where: {
              userId_templateId_taskDate: {
                userId: user.id,
                templateId: signTask.id,
                taskDate: today,
              },
            },
            update: { progress: 1, isCompleted: true, completedAt: new Date() },
            create: {
              userId: user.id,
              templateId: signTask.id,
              taskDate: today,
              progress: 1,
              isCompleted: true,
              completedAt: new Date(),
            },
          })
        : null
    )),
  ]).then((results) => {
    logPerf('checkin.afterwork.ms', afterStart, { userId: user.id })
    results.forEach((item, index) => {
      if (item.status === 'rejected') {
        console.error(index === 0 ? '[achievements:checkin]' : '[dailyTask:checkin]', item.reason)
      }
    })
  })

  
  const verifyStart = Date.now()

const verifyCheckIn = await prisma.checkIn.findUnique({
  where: {
    userId_checkinDateKey: {
      userId: user.id,
      checkinDateKey: todayKey,
    },
  },
  select: {
    id: true,
  },
})

logPerf('checkin.verify.ms', verifyStart, { userId: user.id })

if (!verifyCheckIn) {
  console.error('[checkin.verify.failed]', {
    userId: user.id,
    todayKey,
  })

  return NextResponse.json(
    {
      message: '签到保存失败，请刷新后重试',
      checkedToday: false,
    },
    {
      status: 500,
    },
  )
}
logPerf('checkin.total.ms', requestStart, { userId: user.id })
  return NextResponse.json({
    message: '今日挂号成功',
    checkedToday: true,
    checkDate: formatBeijingDate(today),
    todayCheckIn: result.checkIn,
    mood,
    gainedPoints: result.gainedPoints,
    gainedExp: result.gainedExp,
    bonus: result.bonus,
    dailyMessageId: result.dailyMessageId,
    consecutiveDays: result.user.consecutiveDays,
    points: result.user.points,
    exp: result.user.exp,
    experience: result.user.experience,
    level: result.user.level,
    created: true,
  })
}
