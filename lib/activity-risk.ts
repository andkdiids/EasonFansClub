import { createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getClientIp, normalizeIp } from '@/lib/client-ip'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { createUUID } from '@/lib/utils/uuid'
import {
  ACTIVITY_RISK_RULES,
  evaluateActivityRisk,
  type ActivityRiskEvaluation,
  type ActivityRiskLevel,
  type ActivityRiskRegistrationInput,
  type ActivityRiskRegistrationResult,
  type ActivityRiskSignal,
} from '@/lib/activity-risk-shared'

export { ACTIVITY_RISK_RULES, evaluateActivityRisk }
export type {
  ActivityRiskEvaluation,
  ActivityRiskLevel,
  ActivityRiskRegistrationInput,
  ActivityRiskRegistrationResult,
  ActivityRiskSignal,
} from '@/lib/activity-risk-shared'

export const ACTIVITY_RISK_USER_AGENT_MAX_LENGTH = 500
export const ACTIVITY_RISK_SIGNAL_MAX_LENGTH = 128

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/
const deviceIdPattern = /^[A-Za-z0-9._:-]{8,128}$/

function activityRiskSecret() {
  // A dedicated secret is preferred so changing the JWT secret does not make
  // old audit clusters impossible to compare. JWT_SECRET is a local fallback
  // for deployments that have not added the optional dedicated variable yet.
  return process.env.ACTIVITY_RISK_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || (process.env.NODE_ENV === 'production' ? null : 'ecfc-activity-risk-development-secret')
}

function hmacSignal(value: string, purpose: 'ip' | 'device') {
  const secret = activityRiskSecret()
  return secret ? createHmac('sha256', secret).update(`activity-risk:${purpose}:${value}`).digest('hex') : null
}

export function hashActivityRegistrationIp(value: unknown) {
  const ip = normalizeIp(value)
  return ip ? hmacSignal(ip, 'ip') : null
}

export function hashActivityRegistrationDeviceId(value: unknown) {
  if (typeof value !== 'string') return null
  const deviceId = value.trim()
  return deviceIdPattern.test(deviceId) ? hmacSignal(deviceId, 'device') : null
}

export function normalizeActivityRegistrationUserAgent(value: unknown) {
  if (typeof value !== 'string') return null
  const userAgent = value.trim()
  return userAgent ? userAgent.slice(0, ACTIVITY_RISK_USER_AGENT_MAX_LENGTH) : null
}

export function normalizeActivityRegistrationRequestId(value: unknown) {
  if (typeof value === 'string') {
    const requestId = value.trim()
    if (requestIdPattern.test(requestId)) return requestId
  }
  return createUUID()
}

export function activityRegistrationAuditData(request: Request) {
  return {
    registrationIpHash: hashActivityRegistrationIp(getClientIp(request)),
    registrationUserAgent: normalizeActivityRegistrationUserAgent(request.headers.get('user-agent')),
    registrationDeviceId: hashActivityRegistrationDeviceId(request.headers.get('x-ecfc-activity-device-id')),
    registrationRequestId: normalizeActivityRegistrationRequestId(request.headers.get('x-request-id')),
  }
}

export type ActivityRiskAlert = {
  level: Exclude<ActivityRiskLevel, 'NONE'>
  riskGroupId: string
  accountCount: number
  signals: ActivityRiskSignal[]
  reasons: string[]
}

export type ActivityRiskWinnerView = {
  id: string
  lotteryId: string
  lotteryTitle: string
  prizeName: string
  tierName: string | null
  wonAt: string
  redemptionStatus: string
  redeemedAt: string | null
  registrationId: string | null
}

export type ActivityRiskRegistrationView = ActivityRiskRegistrationResult & {
  uid: number
  username: string
  nickname: string
  avatarUrl: string | null
  accountRegisteredAt: string
  activityRegisteredAt: string
  status: string
  accountStatus: string
  accountDeleted: boolean
  verifiedAt: string | null
  checkedInAt: string | null
  checkInSource: string | null
  auditData: {
    hasIpHash: boolean
    hasDeviceId: boolean
    hasUserAgent: boolean
    hasRequestId: boolean
    legacyWithoutAuditData: boolean
  }
  lotteryWins: ActivityRiskWinnerView[]
}

export type ActivityRiskGroupView = {
  id: string
  level: Exclude<ActivityRiskLevel, 'NONE'>
  accountCount: number
  registrationCount: number
  signals: ActivityRiskSignal[]
  reasons: string[]
  windowStart: string | null
  windowEnd: string | null
  registrations: ActivityRiskRegistrationView[]
}

/** The browser-facing report does not need the internal User.id used for joins. */
export type ActivityRiskPublicRegistrationView = Omit<ActivityRiskRegistrationView, 'userId'>
export type ActivityRiskPublicGroupView = Omit<ActivityRiskGroupView, 'registrations'> & {
  registrations: ActivityRiskPublicRegistrationView[]
}
export type ActivityRiskPublicReport = Omit<ActivityRiskReport, 'groups'> & {
  groups: ActivityRiskPublicGroupView[]
}

export type ActivityRiskReport = {
  activity: { id: string; title: string; status: string }
  summary: {
    totalRegistrations: number
    normalCount: number
    lowCount: number
    mediumCount: number
    highCount: number
    legacyWithoutAuditData: number
  }
  groups: ActivityRiskGroupView[]
  generatedAt: string
}

function publicRiskRegistration(registration: ActivityRiskRegistrationView): ActivityRiskPublicRegistrationView {
  return Object.fromEntries(Object.entries(registration).filter(([key]) => key !== 'userId')) as ActivityRiskPublicRegistrationView
}

export function toPublicActivityRiskReport(report: ActivityRiskReport): ActivityRiskPublicReport {
  return {
    ...report,
    groups: report.groups.map((group) => ({
      ...group,
      registrations: group.registrations.map(publicRiskRegistration),
    })),
  }
}

const activityRiskRegistrationSelect = {
  id: true,
  userId: true,
  status: true,
  registeredAt: true,
  verifiedAt: true,
  checkedInAt: true,
  checkInSource: true,
  registrationIpHash: true,
  registrationUserAgent: true,
  registrationDeviceId: true,
  registrationRequestId: true,
  User: { select: { id: true, uid: true, username: true, nickname: true, avatarUrl: true, createdAt: true, status: true, isDeleted: true } },
} satisfies Prisma.ActivityRegistrationSelect

type ActivityRiskRegistrationRow = Prisma.ActivityRegistrationGetPayload<{ select: typeof activityRiskRegistrationSelect }>

const activityRiskWinnerSelect = {
  id: true,
  userId: true,
  registrationId: true,
  wonAt: true,
  redemptionStatus: true,
  redeemedAt: true,
  Lottery: { select: { id: true, title: true } },
  LotteryPrize: { select: { tierName: true, name: true } },
} satisfies Prisma.LotteryEntrySelect

type ActivityRiskWinnerRow = Prisma.LotteryEntryGetPayload<{ select: typeof activityRiskWinnerSelect }>

function dateIso(value: Date | null | undefined) {
  return value?.toISOString() || null
}

function toRiskAlert(result: ActivityRiskRegistrationResult | undefined): ActivityRiskAlert | null {
  if (!result) return null
  return {
    level: result.level,
    riskGroupId: result.riskGroupId,
    accountCount: result.riskGroupAccountCount,
    signals: result.signals,
    reasons: result.reasons,
  }
}

export function activityRiskAlertsByUserId(report: ActivityRiskReport) {
  const alerts = new Map<string, ActivityRiskAlert>()
  report.groups.forEach((group) => group.registrations.forEach((registration) => {
    alerts.set(registration.userId, {
      level: registration.level,
      riskGroupId: registration.riskGroupId,
      accountCount: registration.riskGroupAccountCount,
      signals: registration.signals,
      reasons: registration.reasons,
    })
  }))
  return alerts
}

export async function getActivityRiskReport(activityId: string): Promise<ActivityRiskReport | null> {
  const [activity, registrations, winners] = await Promise.all([
    prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, status: true } }),
    prisma.activityRegistration.findMany({ where: { activityId }, orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }], select: activityRiskRegistrationSelect }),
    prisma.lotteryEntry.findMany({ where: { Lottery: { activityId } }, orderBy: [{ wonAt: 'asc' }, { id: 'asc' }], select: activityRiskWinnerSelect }),
  ])
  if (!activity) return null

  const evaluation: ActivityRiskEvaluation = evaluateActivityRisk(registrations.map((registration): ActivityRiskRegistrationInput => ({
    registrationId: registration.id,
    userId: registration.userId,
    accountRegisteredAt: registration.User.createdAt,
    activityRegisteredAt: registration.registeredAt,
    registrationIpHash: registration.registrationIpHash,
    registrationDeviceId: registration.registrationDeviceId,
    registrationUserAgent: registration.registrationUserAgent,
    registrationRequestId: registration.registrationRequestId,
  })))
  const registrationById = new Map<string, ActivityRiskRegistrationRow>(registrations.map((registration) => [registration.id, registration]))
  const winnersByUserId = new Map<string, ActivityRiskWinnerRow[]>()
  winners.forEach((winner) => {
    const current = winnersByUserId.get(winner.userId) || []
    current.push(winner)
    winnersByUserId.set(winner.userId, current)
  })

  const groups: ActivityRiskGroupView[] = evaluation.groups.map((group) => ({
    id: group.id,
    level: group.level,
    accountCount: group.accountCount,
    registrationCount: group.registrationCount,
    signals: group.signals,
    reasons: group.reasons,
    windowStart: group.windowStart,
    windowEnd: group.windowEnd,
    registrations: group.registrations.flatMap((riskRegistration) => {
      const registration = registrationById.get(riskRegistration.registrationId)
      if (!registration) return []
      const lotteryWins = (winnersByUserId.get(registration.userId) || []).map((winner) => ({
        id: winner.id,
        lotteryId: winner.Lottery.id,
        lotteryTitle: winner.Lottery.title,
        prizeName: winner.LotteryPrize?.name || '奖品',
        tierName: winner.LotteryPrize?.tierName || null,
        wonAt: winner.wonAt.toISOString(),
        redemptionStatus: winner.redemptionStatus,
        redeemedAt: dateIso(winner.redeemedAt),
        registrationId: winner.registrationId,
      }))
      return [{
        ...riskRegistration,
        uid: registration.User.uid,
        username: registration.User.username,
        nickname: registration.User.nickname,
        avatarUrl: publicImageUrl(registration.User.avatarUrl),
        accountRegisteredAt: registration.User.createdAt.toISOString(),
        activityRegisteredAt: registration.registeredAt.toISOString(),
        status: registration.status,
        accountStatus: registration.User.status,
        accountDeleted: registration.User.isDeleted,
        verifiedAt: dateIso(registration.verifiedAt),
        checkedInAt: dateIso(registration.checkedInAt),
        checkInSource: registration.checkInSource,
        auditData: {
          hasIpHash: Boolean(registration.registrationIpHash),
          hasDeviceId: Boolean(registration.registrationDeviceId),
          hasUserAgent: Boolean(registration.registrationUserAgent),
          hasRequestId: Boolean(registration.registrationRequestId),
          legacyWithoutAuditData: riskRegistration.legacyWithoutAuditData,
        },
        lotteryWins,
      }]
    }),
  }))

  return {
    activity,
    summary: {
      totalRegistrations: evaluation.totalRegistrations,
      normalCount: evaluation.normalCount,
      lowCount: evaluation.lowCount,
      mediumCount: evaluation.mediumCount,
      highCount: evaluation.highCount,
      legacyWithoutAuditData: evaluation.legacyWithoutAuditData,
    },
    groups,
    generatedAt: new Date().toISOString(),
  }
}

export async function getActivityRiskAlert(activityId: string, userId: string) {
  try {
    const report = await getActivityRiskReport(activityId)
    if (!report) return null
    const registration = report.groups.flatMap((group) => group.registrations).find((candidate) => candidate.userId === userId)
    return registration ? toRiskAlert(registration) : null
  } catch (error) {
    // Risk review is a secondary signal. A temporary read/migration problem
    // must never turn a valid redemption lookup or confirmation into a
    // business failure; the admin risk page will still surface the error.
    console.error('[activity-risk.alert]', error instanceof Error ? error.message : error)
    return null
  }
}
