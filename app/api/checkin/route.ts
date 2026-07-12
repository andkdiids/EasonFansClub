import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { isSameLocalDay, startOfLocalDay, startOfYesterday } from '@/lib/checkin'
import { CHECK_IN_EXP, CHECK_IN_POINTS, getMood, getStreakBonus } from '@/lib/daily'
import { safeDb } from '@/lib/db-timeout'
import { calcLevel } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, sanitizeText } from '@/lib/security'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const today = startOfLocalDay()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)

  const profile = await safeDb(
    'User.findUnique checkinApi.profile',
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        points: true,
        exp: true,
        consecutiveDays: true,
        lastCheckInDate: true,
        checkIns: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
        },
      },
    }),
    null,
  )
  const todayCount = await safeDb('CheckIn.count checkinApi.todayCount', prisma.checkIn.count({ where: { checkDate: today } }), 0)
  const moodStats = await safeDb(
    'CheckIn.groupBy checkinApi.moodStats',
    prisma.checkIn.groupBy({
      by: ['mood'],
      where: { checkDate: today, mood: { not: null } },
      _count: { mood: true },
    }),
    [],
  )

  if (!profile) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  return NextResponse.json({
    checkedToday: isSameLocalDay(profile.lastCheckInDate),
    consecutiveDays: profile.consecutiveDays,
    totalCheckIns: profile.checkIns.length,
    points: profile.points,
    exp: profile.exp,
    todayCount,
    moodStats,
    recentCheckIns: profile.checkIns,
    today,
    tomorrow,
  })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再挂号' }, { status: 401 })

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

  let existing
  try {
    existing = await prisma.checkIn.findUnique({
      where: { userId_checkDate: { userId: user.id, checkDate: today } },
    })
  } catch (error) {
    console.error('[api/checkin] prisma query failed', {
      model: 'CheckIn',
      query: 'findUnique',
      feature: 'checkinApi.existing',
      where: ['userId=currentUser.id', 'checkDate=today'],
    }, error)
    throw error
  }

  if (existing) {
    let profile
    try {
      profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, consecutiveDays: true },
      })
    } catch (error) {
      console.error('[api/checkin] prisma query failed', {
        model: 'User',
        query: 'findUnique',
        feature: 'checkinApi.existingProfile',
        where: ['id=currentUser.id'],
      }, error)
      throw error
    }
    return NextResponse.json({
      message: '今天已经挂号过了',
      checkedToday: true,
      consecutiveDays: profile?.consecutiveDays ?? existing.streakDay,
      points: profile?.points ?? 0,
      exp: profile?.exp ?? 0,
      gainedPoints: 0,
      gainedExp: 0,
    })
  }

  let result
  try {
    result = await prisma.$transaction(async (tx) => {
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

    const signTask = await tx.dailyTaskTemplate.findUnique({ where: { key: 'daily-checkin' } })
    if (signTask) {
      await tx.dailyTaskProgress.upsert({
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
    }

    return { user: updatedUser, gainedPoints, gainedExp, bonus, dailyMessageId }
    })
  } catch (error) {
    console.error('[api/checkin] prisma transaction failed', {
      feature: 'checkinApi.createCheckIn',
      queries: [
        { model: 'User', query: 'findUniqueOrThrow' },
        { model: 'CheckIn', query: 'create' },
        { model: 'DailyMessage', query: 'create', conditional: 'when message exists' },
        { model: 'User', query: 'update' },
        { model: 'PointLog', query: 'create' },
        { model: 'DailyTaskTemplate', query: 'findUnique' },
        { model: 'DailyTaskProgress', query: 'upsert', conditional: 'when template exists' },
      ],
    }, error)
    throw error
  }

  await syncUserAchievements(user.id, ['CHECKIN_STREAK', 'CHECKIN_TOTAL']).catch((achievementError) => {
    console.error('[achievements:checkin]', achievementError)
  })

  return NextResponse.json({
    message: '今日挂号成功！',
    checkedToday: true,
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
