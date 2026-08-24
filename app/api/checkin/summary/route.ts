import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { getCheckInPublicStats } from '@/lib/checkin-stats'
import { DAILY_MOODS, calcMoodIndex, getDailyQuote } from '@/lib/daily'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey(today)

  const [publicStats, onlineCount, tasks, progress, history] = await Promise.all([
    getCheckInPublicStats(todayKey),
    prisma.user.count({ where: { isOnline: true, isDeleted: false } }),
    prisma.dailyTaskTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
    user
      ? prisma.dailyTaskProgress.findMany({
          where: { userId: user.id, taskDate: today },
        })
      : Promise.resolve([]),
    user
      ? prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } })
      : Promise.resolve([]),
  ])
  const { todayCount, moodStats } = publicStats

  const progressMap = new Map(progress.map((item) => [item.templateId, item]))
  const moodMap = new Map(moodStats.map((item) => [item.mood, item._count.mood]))
  const streaks = calculateCheckinStreaks(history.map((item) => item.checkinDateKey))

  return NextResponse.json({
    date: today,
    weather: {
      city: '深圳',
      text: '浅蓝微风',
      temperature: '26°C',
      note: '天气 API 已预留，当前为本地展示数据',
    },
    quote: getDailyQuote(today),
    todayCount,
    onlineCount,
    totalCheckIns: streaks.totalDays,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    moodIndex: calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } }))),
    moods: DAILY_MOODS.map((mood) => ({
      ...mood,
      count: moodMap.get(mood.key) || 0,
    })),
    tasks: tasks.map((task) => {
      const item = progressMap.get(task.id)
      return {
        id: task.id,
        key: task.key,
        title: task.title,
        description: task.description,
        target: task.target,
        points: task.points,
        exp: task.exp,
        progress: item?.progress || 0,
        isCompleted: Boolean(item?.isCompleted),
      }
    }),
  })
}
