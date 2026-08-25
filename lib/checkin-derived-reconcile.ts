import { syncUserAchievements } from '@/lib/achievements'
import { evaluateBadgesForEvent } from '@/lib/badge-rule-engine'
import { parseBeijingDate } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'

export type CheckInDerivedReconcileResult = {
  userId: string
  dateKey: string
  checkInFound: boolean
  dailyTaskProgressPresent: boolean
  applied: boolean
}

/**
 * Rebuild derived check-in state from the durable CheckIn fact. This is kept
 * outside the request path and is safe to retry after a process interruption.
 */
export async function reconcileCheckInDerivedState(input: { userId: string; dateKey: string; apply: boolean }): Promise<CheckInDerivedReconcileResult> {
  const taskDate = parseBeijingDate(input.dateKey)
  if (!taskDate) throw new Error('INVALID_CHECKIN_DATE_KEY')

  const checkIn = await prisma.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId: input.userId, checkinDateKey: input.dateKey } },
    select: { id: true },
  })
  if (!checkIn) return { userId: input.userId, dateKey: input.dateKey, checkInFound: false, dailyTaskProgressPresent: false, applied: false }

  const task = await prisma.dailyTaskTemplate.findUnique({ where: { key: 'daily-checkin' }, select: { id: true } })
  const existingProgress = task
    ? await prisma.dailyTaskProgress.findUnique({
        where: { userId_templateId_taskDate: { userId: input.userId, templateId: task.id, taskDate } },
        select: { id: true, isCompleted: true },
      })
    : null
  if (!input.apply) {
    return {
      userId: input.userId,
      dateKey: input.dateKey,
      checkInFound: true,
      dailyTaskProgressPresent: Boolean(existingProgress?.isCompleted),
      applied: false,
    }
  }

  if (task) {
    await prisma.dailyTaskProgress.upsert({
      where: { userId_templateId_taskDate: { userId: input.userId, templateId: task.id, taskDate } },
      update: { progress: 1, isCompleted: true, completedAt: new Date() },
      create: { userId: input.userId, templateId: task.id, taskDate, progress: 1, isCompleted: true, completedAt: new Date() },
    })
  }
  await syncUserAchievements(input.userId, ['CHECKIN_STREAK', 'CHECKIN_TOTAL'])
  const badgeSummary = await evaluateBadgesForEvent(input.userId, 'CHECKIN_CREATED')
  if (badgeSummary.failed > 0) throw new Error(`BADGE_RECONCILIATION_FAILED:${badgeSummary.failed}`)

  return {
    userId: input.userId,
    dateKey: input.dateKey,
    checkInFound: true,
    dailyTaskProgressPresent: true,
    applied: true,
  }
}
