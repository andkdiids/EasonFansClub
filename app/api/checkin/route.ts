import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { formatBeijingDate, isSameLocalDay, startOfLocalDay, startOfYesterday } from '@/lib/checkin'
import { CHECK_IN_EXP, CHECK_IN_POINTS, getMood, getStreakBonus } from '@/lib/daily'
import { safeDb } from '@/lib/db-timeout'
import { calcLevel } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, sanitizeText } from '@/lib/security'

function logPerf(metric: string, start: number, extra?: Record<string, unknown>) {
  console.info('[perf]', { metric, ms: Date.now() - start, ...extra })
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const today = startOfLocalDay()
  const [profile, todayCheckIn, todayCount, moodStats, totalCheckIns] = await Promise.all([
    safeDb(
      'User.findUnique checkinApi.profile',
      prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, level: true, consecutiveDays: true, lastCheckInDate: true },
      }),
      null,
    ),
    safeDb(
      'CheckIn.findUnique checkinApi.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkDate: { userId: user.id, checkDate: today } },
        select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
      }),
      null,
    ),
    safeDb('CheckIn.count checkinApi.todayCount', prisma.checkIn.count({ where: { checkDate: today } }), 0),
    safeDb(
      'CheckIn.groupBy checkinApi.moodStats',
      prisma.checkIn.groupBy({
        by: ['mood'],
        where: { checkDate: today, mood: { not: null } },
        _count: { mood: true },
      }),
      [],
    ),
    safeDb('CheckIn.count checkinApi.totalCheckIns', prisma.checkIn.count({ where: { userId: user.id } }), 0),
  ])

  if (!profile) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  return NextResponse.json({
    checkedToday: Boolean(todayCheckIn),
    todayCheckIn,
    consecutiveDays: profile.consecutiveDays,
    totalCheckIns,
    points: profile.points,
    exp: profile.exp,
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
  const message = await filterSensitiveWords(rawMessage)

  if (!mood) {
    return NextResponse.json({ message: '请选择今日心情' }, { status: 400 })
  }

  const today = startOfLocalDay()
  const yesterday = startOfYesterday()

  const existingStart = Date.now()
  const existing = await prisma.checkIn.findUnique({
    where: { userId_checkDate: { userId: user.id, checkDate: today } },
    select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
  })
  logPerf('checkin.existing.ms', existingStart, { userId: user.id })

  if (existing) {
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { points: true, exp: true, level: true, consecutiveDays: true },
    })
    return NextResponse.json({
      message: '今天已经挂号过了',
      checkedToday: true,
      checkDate: formatBeijingDate(today),
      todayCheckIn: existing,
      consecutiveDays: profile?.consecutiveDays ?? existing.streakDay,
      points: profile?.points ?? 0,
      exp: profile?.exp ?? 0,
      level: profile?.level ?? 1,
      gainedPoints: 0,
      gainedExp: 0,
    })
  }

  const transactionStart = Date.now()
  const result = await prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { points: true, exp: true, consecutiveDays: true, lastCheckInDate: true },
    })

    const nextStreak = isSameLocalDay(currentUser.lastCheckInDate, yesterday)
      ? currentUser.consecutiveDays + 1
      : 1
    const bonus = getStreakBonus(nextStreak)
    const gainedPoints = CHECK_IN_POINTS + (bonus?.points || 0)
    const gainedExp = CHECK_IN_EXP + (bonus?.exp || 0)
    const nextPoints = currentUser.points + gainedPoints
    const nextExp = currentUser.exp + gainedExp

    const checkIn = await tx.checkIn.create({
      data: {
        userId: user.id,
        checkDate: today,
        points: gainedPoints,
        exp: gainedExp,
        streakDay: nextStreak,
        mood: mood.key,
        message: message || null,
      },
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

    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        points: nextPoints,
        exp: nextExp,
        consecutiveDays: nextStreak,
        lastCheckInDate: today,
        level: calcLevel(nextPoints + nextExp),
      },
      select: { points: true, exp: true, consecutiveDays: true, level: true },
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

    return { user: updatedUser, checkIn, gainedPoints, gainedExp, bonus, dailyMessageId }
  })
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
    level: result.user.level,
  })
}
