import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, formatBeijingDate, getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { getMood, getStreakBonus } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
import { awardExperience, getRandomCheckInExperience } from '@/lib/growth'
import { getRandomCheckInPoints } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey()
  const [profile, todayCheckIn, todayCount, moodStats, history] = await Promise.all([
    safeDb(
      'User.findUnique checkinApi.profile',
      prisma.user.findUnique({
        where: { id: user.id },
        select: { points: true, exp: true, experience: true, level: true, consecutiveDays: true, checkinMoodEnabled: true },
      }),
      null,
    ),
    withDbTimeout(
      'CheckIn.findUnique checkinApi.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } },
        select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
      }),
      8000,
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
    moodStats,
    checkinMoodEnabled: profile.checkinMoodEnabled,
    todayValue: formatBeijingDate(today),
  })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再挂号' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const moodKey = sanitizeText(body?.mood, 40)
  const requestedMood = getMood(moodKey)
  const preference = await prisma.user.findUnique({ where: { id: user.id }, select: { checkinMoodEnabled: true } })
  if (!preference) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const mood = preference.checkinMoodEnabled ? requestedMood : null
  const rawMessage = sanitizeText(body?.message, 300)
  if (await containsSensitiveContent(rawMessage)) {
    return NextResponse.json({ message: '留言包含违禁词，无法发布' }, { status: 400 })
  }
  const message = rawMessage

  if (preference.checkinMoodEnabled && !mood) {
    return NextResponse.json({ message: '请选择今日心情' }, { status: 400 })
  }

  const checkedAt = new Date()
  const today = startOfLocalDay(checkedAt)
  const todayKey = getShanghaiDateKey(checkedAt)

  const existing = await prisma.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: todayKey } },
    select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
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
        message: message || null,
      },
      select: { id: true, checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
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
      sourceType: 'DAILY_CHECKIN',
      sourceId: createdCheckIn.id,
    })
    const gainedExp = expAward.amount
    const checkIn = await tx.checkIn.update({
      where: { id: createdCheckIn.id },
      data: { points: gainedPoints, exp: gainedExp },
      select: { id: true, checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
    })
    let dailyMessageId: string | null = null
    if (message) {
      const dailyMessage = await tx.dailyMessage.create({
        data: {
          userId: user.id,
          checkInId: checkIn.id,
          date: today,
          mood: mood?.key ?? null,
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
        mood: mood?.key ?? null,
        content: message || null,
      },
    })

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
const [verifyCheckIn, verifyUser] = await Promise.all([
  prisma.checkIn.findUnique({
    where: {
      userId_checkinDateKey: {
        userId: user.id,
        checkinDateKey: todayKey,
      },
    },
    select: {
      id: true,
      checkDate: true,
      points: true,
      exp: true,
      mood: true,
      message: true,
      streakDay: true,
      createdAt: true,
    },
  }),

  prisma.user.findUnique({
    where: {
      id: user.id,
    },
    select: {
      points: true,
      exp: true,
      experience: true,
      level: true,
      consecutiveDays: true,
    },
  }),
])

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

if (
  verifyCheckIn.id !== result.checkIn.id
  || verifyCheckIn.points !== result.checkIn.points
  || verifyCheckIn.exp !== result.checkIn.exp
) {
  console.error('[checkin.verify.mismatch]', {
    userId: user.id,
    todayKey,
    transaction: {
      id: result.checkIn.id,
      points: result.checkIn.points,
      exp: result.checkIn.exp,
    },
    verified: {
      id: verifyCheckIn.id,
      points: verifyCheckIn.points,
      exp: verifyCheckIn.exp,
    },
  })
  return NextResponse.json(
    { message: '签到数据校验不一致，请刷新后重试', checkedToday: false },
    { status: 500 },
  )
}



const postCheckinResults = await Promise.allSettled([
  syncUserAchievements(user.id, ['CHECKIN_STREAK', 'CHECKIN_TOTAL']),
  prisma.dailyTaskTemplate.findUnique({ 
    where: { key: 'daily-checkin' }, 
    select: { id: true } 
  }).then((signTask) => (
    signTask
      ? prisma.dailyTaskProgress.upsert({
          where: {
            userId_templateId_taskDate: {
              userId: user.id,
              templateId: signTask.id,
              taskDate: today,
            },
          },
          update: { 
            progress: 1, 
            isCompleted: true, 
            completedAt: new Date() 
          },
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
])
postCheckinResults.forEach((item, index) => {
    if (item.status === 'rejected') {
      console.error(
        index === 0 
          ? '[achievements:checkin]' 
          : '[dailyTask:checkin]', 
        item.reason
      )
    }
  })

return NextResponse.json({
    message: '今日挂号成功',
    checkedToday: true,
    checkDate: formatBeijingDate(today),
    todayCheckIn: verifyCheckIn,
    mood,
    gainedPoints: verifyCheckIn.points,
    gainedExp: verifyCheckIn.exp,
    bonus: result.bonus,
    ordinaryRegistrationFee: result.ordinaryRegistrationFee,
    streakBonusRegistrationFee: result.streakBonusRegistrationFee,
    dailyMessageId: result.dailyMessageId,
    consecutiveDays: result.streaks.currentStreak,
    currentStreak: result.streaks.currentStreak,
    longestStreak: result.streaks.longestStreak,
points: verifyUser?.points ?? result.user.points,
exp: verifyUser?.exp ?? result.user.exp,
experience: verifyUser?.experience ?? result.user.experience,
level: verifyUser?.level ?? result.user.level,
    created: true,
  })
}
