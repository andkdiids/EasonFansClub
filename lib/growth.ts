import type { ExperienceLogType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { defaultGrowthLevels, resolveGrowthLevelName } from '@/lib/growth-display'

export const dailyExpLimit = 30
export { defaultGrowthLevels, resolveGrowthLevelName }

export type GrowthLevel = {
  level: number
  name: string
  requiredExp: number
}

export type GrowthSummary = {
  level: number
  levelName: string
  experience: number
  currentRequiredExp: number
  nextRequiredExp: number | null
  progressPercent: number
}

const beijingOffsetMs = 8 * 60 * 60 * 1000

export function getBeijingDayStart(date = new Date()) {
  const beijingDate = new Date(date.getTime() + beijingOffsetMs)
  return new Date(Date.UTC(beijingDate.getUTCFullYear(), beijingDate.getUTCMonth(), beijingDate.getUTCDate()) - beijingOffsetMs)
}

export function getRandomCheckInExperience() {
  return Math.floor(Math.random() * 6) + 5
}

export function normalizeGrowthLevels(levels: GrowthLevel[]) {
  const merged = levels.length ? levels : [...defaultGrowthLevels]
  return merged
    .map((item) => ({
      level: Math.max(1, Math.min(7, Number(item.level) || 1)),
      name: resolveGrowthLevelName(item.level, item.name),
      requiredExp: Math.max(0, Math.floor(Number(item.requiredExp) || 0)),
    }))
    .sort((a, b) => a.requiredExp - b.requiredExp || a.level - b.level)
}

export async function listGrowthLevels(tx: Pick<Prisma.TransactionClient, 'growthLevelConfig'> | typeof prisma = prisma) {
  const rows = await tx.growthLevelConfig.findMany({
    orderBy: { level: 'asc' },
    select: { level: true, name: true, requiredExp: true },
  })
  return normalizeGrowthLevels(rows)
}

export function calculateGrowthSummary(experience: number, levels: GrowthLevel[]): GrowthSummary {
  const normalized = normalizeGrowthLevels(levels)
  const safeExperience = Math.max(0, Math.floor(experience || 0))
  const current = normalized.reduce((match, item) => (safeExperience >= item.requiredExp ? item : match), normalized[0])
  const next = normalized.find((item) => item.requiredExp > current.requiredExp) || null
  const span = next ? Math.max(1, next.requiredExp - current.requiredExp) : 1
  const gained = Math.max(0, safeExperience - current.requiredExp)
  return {
    level: current.level,
    levelName: current.name,
    experience: safeExperience,
    currentRequiredExp: current.requiredExp,
    nextRequiredExp: next?.requiredExp ?? null,
    progressPercent: next ? Math.min(100, Math.round((gained / span) * 100)) : 100,
  }
}

export async function getGrowthSummary(experience: number) {
  return calculateGrowthSummary(experience, await listGrowthLevels())
}

export async function getGrowthSummarySafe(experience: number) {
  return getGrowthSummary(experience).catch(() => calculateGrowthSummary(experience, [...defaultGrowthLevels]))
}

export async function awardExperience(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    amount: number
    type: ExperienceLogType
    description: string
    now?: Date
    sourceType?: string
    sourceId?: string
  },
) {
  const requestedAmount = Math.max(0, Math.floor(input.amount || 0))
  const date = getBeijingDayStart(input.now || new Date())
  const existing = await tx.dailyExperienceRecord.findUnique({
    where: { userId_date: { userId: input.userId, date } },
    select: { amount: true },
  })
  const usedToday = existing?.amount || 0
  const amount = Math.min(requestedAmount, Math.max(0, dailyExpLimit - usedToday))

  if (amount <= 0) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { experience: true, exp: true, level: true },
    })
    return { amount: 0, user, dailyAmount: usedToday }
  }

  const levels = await listGrowthLevels(tx)
  const currentUser = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { experience: true, exp: true },
  })
  const nextExperience = currentUser.experience + amount
  const nextLegacyExp = currentUser.exp + amount
  const nextLevel = calculateGrowthSummary(nextExperience, levels).level

  await tx.dailyExperienceRecord.upsert({
    where: { userId_date: { userId: input.userId, date } },
    update: { amount: { increment: amount } },
    create: { userId: input.userId, date, amount },
  })

  await tx.experienceLog.create({
    data: {
      userId: input.userId,
      amount,
      type: input.type,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
  })

  const user = await tx.user.update({
    where: { id: input.userId },
    data: {
      experience: nextExperience,
      exp: nextLegacyExp,
      level: nextLevel,
    },
    select: { experience: true, exp: true, level: true },
  })

  return { amount, user, dailyAmount: usedToday + amount }
}
