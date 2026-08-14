import { Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { calculateGrowthSummary, listGrowthLevels } from '@/lib/growth'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'
import {
  USER_REWARD_MAX_AMOUNT,
  USER_REWARD_NOTIFICATION_TYPE,
  USER_REWARD_PAGE_SIZE,
  USER_REWARD_PERMISSION,
  USER_REWARD_REASON_MAX_LENGTH,
} from '@/lib/user-reward-constants'

export { USER_REWARD_MAX_AMOUNT, USER_REWARD_NOTIFICATION_TYPE, USER_REWARD_PAGE_SIZE, USER_REWARD_PERMISSION, USER_REWARD_REASON_MAX_LENGTH }

const MYSQL_SIGNED_INT_MAX = 2_147_483_647
const forbiddenUserRewardReasonPhrases = [
  '管理员奖励你',
  '管理员向你发放',
  '管理员赠送',
  '管理员给你',
  '管理员奖励',
]

export class UserRewardError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'UserRewardError'
  }
}

export type UserRewardInput = {
  transactionId: unknown
  userId: unknown
  operatorId: unknown
  experienceAmount: unknown
  registrationFeeAmount: unknown
  reason: unknown
}

export type NormalizedUserRewardInput = {
  transactionId: string
  userId: string
  operatorId: string
  experienceAmount: number
  registrationFeeAmount: number
  reason: string
}

function parseRewardAmount(value: unknown, label: string) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > USER_REWARD_MAX_AMOUNT) {
    throw new UserRewardError('INVALID_AMOUNT', `${label}必须是 0 到 ${USER_REWARD_MAX_AMOUNT} 之间的整数`)
  }
  return parsed
}

export function normalizeUserRewardInput(input: UserRewardInput): NormalizedUserRewardInput {
  const transactionId = sanitizeText(input.transactionId, 120)
  const userId = sanitizeText(input.userId, 80)
  const operatorId = sanitizeText(input.operatorId, 80)
  const reason = sanitizeText(input.reason, USER_REWARD_REASON_MAX_LENGTH)
  const experienceAmount = parseRewardAmount(input.experienceAmount, '奖励经验值')
  const registrationFeeAmount = parseRewardAmount(input.registrationFeeAmount, '奖励挂号费')

  if (!transactionId || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(transactionId)) {
    throw new UserRewardError('INVALID_TRANSACTION_ID', '奖励请求编号无效，请重新提交')
  }
  if (!userId || !operatorId) throw new UserRewardError('INVALID_USER', '用户信息无效，请重新选择用户')
  if (!reason) throw new UserRewardError('REASON_REQUIRED', '奖励说明不能为空')
  if (forbiddenUserRewardReasonPhrases.some((phrase) => reason.includes(phrase))) {
    throw new UserRewardError('INVALID_REASON', '奖励说明请使用中性、具体的贡献描述')
  }
  if (experienceAmount === 0 && registrationFeeAmount === 0) {
    throw new UserRewardError('REWARD_REQUIRED', '经验值和挂号费至少需要填写一项')
  }

  return { transactionId, userId, operatorId, experienceAmount, registrationFeeAmount, reason }
}

export function buildUserRewardNotificationContent(input: Pick<NormalizedUserRewardInput, 'experienceAmount' | 'registrationFeeAmount' | 'reason'>) {
  const lines = ['获得以下奖励：']
  if (input.experienceAmount > 0) lines.push(`经验值 +${input.experienceAmount}`)
  if (input.registrationFeeAmount > 0) lines.push(`挂号费 +${input.registrationFeeAmount}`)
  lines.push('', `奖励说明：${input.reason}`)
  return lines.join('\n')
}

export function getUserRewardPointBusinessKey(rewardId: string) {
  return `user-reward:${rewardId}`
}

const rewardUserSelect = {
  id: true,
  uid: true,
  username: true,
  nickname: true,
  email: true,
  phone: true,
  avatarUrl: true,
  exp: true,
  experience: true,
  points: true,
  Profile: { select: { displayName: true, avatarUrl: true } },
} satisfies Prisma.UserSelect

type RewardUser = Prisma.UserGetPayload<{ select: typeof rewardUserSelect }>

export function serializeRewardUser(user: RewardUser) {
  return {
    id: user.id,
    uid: user.uid,
    username: user.username,
    nickname: user.nickname,
    displayName: user.Profile?.displayName || user.nickname || user.username,
    email: user.email,
    phone: user.phone,
    avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
    experience: user.experience,
    points: user.points,
  }
}

const userRewardHistorySelect = {
  id: true,
  transactionId: true,
  usernameSnapshot: true,
  experienceAmount: true,
  registrationFeeAmount: true,
  reason: true,
  operatorId: true,
  createdAt: true,
  recipient: {
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      Profile: { select: { displayName: true } },
    },
  },
  operator: {
    select: {
      id: true,
      username: true,
      nickname: true,
      Profile: { select: { displayName: true } },
    },
  },
} satisfies Prisma.UserRewardSelect

type UserRewardHistoryRow = Prisma.UserRewardGetPayload<{ select: typeof userRewardHistorySelect }>

export function serializeUserReward(row: UserRewardHistoryRow) {
  return {
    rewardId: row.id,
    transactionId: row.transactionId,
    userId: row.recipient.id,
    userUid: row.recipient.uid,
    username: row.usernameSnapshot || row.recipient.username,
    experienceAmount: row.experienceAmount,
    registrationFeeAmount: row.registrationFeeAmount,
    reason: row.reason,
    operatorId: row.operatorId,
    operatorName: row.operator.Profile?.displayName || row.operator.nickname || row.operator.username,
    createdAt: row.createdAt.toISOString(),
  }
}

function parseShanghaiDate(value: string | undefined, endExclusive = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000+08:00`)
  if (Number.isNaN(date.getTime())) return null
  if (endExclusive) date.setTime(date.getTime() + 24 * 60 * 60 * 1000)
  return date
}

export async function searchUserRewardUsers(query: string) {
  const q = sanitizeText(query, 80)
  if (!q) return []
  const numericUid = /^\d+$/.test(q) ? Number(q) : Number.NaN
  const users = await prisma.user.findMany({
    where: {
      uid: { gt: 0 },
      isDeleted: false,
      status: 'ACTIVE',
      OR: [
        { id: q },
        { username: { contains: q } },
        { nickname: { contains: q } },
        { phone: { contains: q } },
        { email: { contains: q } },
        { Profile: { displayName: { contains: q } } },
        ...(Number.isSafeInteger(numericUid) ? [{ uid: numericUid }] : []),
      ],
    },
    orderBy: { uid: 'asc' },
    take: 20,
    select: rewardUserSelect,
  })
  return users.map(serializeRewardUser)
}

export type UserRewardHistoryFilters = {
  q?: string
  operatorId?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export async function listUserRewards(filters: UserRewardHistoryFilters = {}) {
  const q = sanitizeText(filters.q, 80)
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize || USER_REWARD_PAGE_SIZE) || USER_REWARD_PAGE_SIZE, 1), 50)
  const requestedPage = Math.max(1, Math.trunc(filters.page || 1) || 1)
  const from = parseShanghaiDate(filters.from)
  const to = parseShanghaiDate(filters.to, true)
  const recipientSearch = q
    ? {
        OR: [
          { id: q },
          { username: { contains: q } },
          { nickname: { contains: q } },
          { Profile: { displayName: { contains: q } } },
          ...(/^\d+$/.test(q) ? [{ uid: Number(q) }] : []),
        ],
      }
    : undefined
  const where: Prisma.UserRewardWhereInput = {
    ...(recipientSearch ? { recipient: recipientSearch } : {}),
    ...(filters.operatorId ? { operatorId: sanitizeText(filters.operatorId, 80) } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  }

  const total = await prisma.userReward.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const rows = await prisma.userReward.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: userRewardHistorySelect,
  })

  return {
    items: rows.map(serializeUserReward),
    page,
    pageSize,
    total,
    totalPages,
  }
}

export async function listUserRewardOperators() {
  const users = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
    orderBy: { uid: 'asc' },
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      Profile: { select: { displayName: true } },
    },
  })
  return users.map((user) => ({
    id: user.id,
    uid: user.uid,
    name: user.Profile?.displayName || user.nickname || user.username,
  }))
}

function assertIdempotencyMatch(existing: { transactionId: string; userId: string; operatorId: string; experienceAmount: number; registrationFeeAmount: number; reason: string }, input: NormalizedUserRewardInput) {
  if (
    existing.userId !== input.userId
    || existing.operatorId !== input.operatorId
    || existing.experienceAmount !== input.experienceAmount
    || existing.registrationFeeAmount !== input.registrationFeeAmount
    || existing.reason !== input.reason
  ) {
    throw new UserRewardError('IDEMPOTENCY_CONFLICT', '奖励请求编号已经对应另一笔奖励')
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function grantUserReward(input: UserRewardInput) {
  const normalized = normalizeUserRewardInput(input)
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.userReward.findUnique({ where: { transactionId: normalized.transactionId } })
      if (existing) {
        assertIdempotencyMatch(existing, normalized)
        const user = await tx.user.findUniqueOrThrow({ where: { id: existing.userId }, select: rewardUserSelect })
        return { duplicate: true, reward: existing, user }
      }

      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${normalized.userId} FOR UPDATE`
      const recipient = await tx.user.findFirst({
        where: { id: normalized.userId, uid: { gt: 0 }, isDeleted: false, status: 'ACTIVE' },
        select: rewardUserSelect,
      })
      if (!recipient) throw new UserRewardError('USER_NOT_FOUND', '用户不存在或当前不可奖励')
      if (
        recipient.experience > MYSQL_SIGNED_INT_MAX - normalized.experienceAmount
        || recipient.exp > MYSQL_SIGNED_INT_MAX - normalized.experienceAmount
        || recipient.points > MYSQL_SIGNED_INT_MAX - normalized.registrationFeeAmount
      ) {
        throw new UserRewardError('BALANCE_OVERFLOW', '奖励数值超出用户余额可保存范围')
      }

      const reward = await tx.userReward.create({
        data: {
          transactionId: normalized.transactionId,
          userId: recipient.id,
          operatorId: normalized.operatorId,
          usernameSnapshot: recipient.username,
          experienceAmount: normalized.experienceAmount,
          registrationFeeAmount: normalized.registrationFeeAmount,
          reason: normalized.reason,
        },
      })

      if (normalized.experienceAmount > 0) {
        const nextExperience = recipient.experience + normalized.experienceAmount
        const nextLegacyExp = recipient.exp + normalized.experienceAmount
        const levels = await listGrowthLevels(tx)
        const nextLevel = calculateGrowthSummary(nextExperience, levels).level
        await tx.experienceLog.create({
          data: {
            userId: recipient.id,
            amount: normalized.experienceAmount,
            type: 'ADMIN',
            description: normalized.reason,
            sourceType: USER_REWARD_NOTIFICATION_TYPE,
            sourceId: reward.id,
          },
        })
        await tx.user.update({
          where: { id: recipient.id },
          data: { experience: nextExperience, exp: nextLegacyExp, level: nextLevel },
        })
      }

      if (normalized.registrationFeeAmount > 0) {
        await awardRegistrationFee(tx, {
          userId: recipient.id,
          requestedAmount: normalized.registrationFeeAmount,
          action: 'USER_REWARD',
          reason: normalized.reason,
          businessKey: getUserRewardPointBusinessKey(reward.id),
        })
      }

      const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: recipient.id }, select: rewardUserSelect })
      await tx.notification.create({
        data: {
          recipientId: recipient.id,
          type: USER_REWARD_NOTIFICATION_TYPE,
          title: '获得奖励',
          content: buildUserRewardNotificationContent(normalized),
          link: '/profile',
          key: `user-reward:${reward.id}`,
          createdAt: reward.createdAt,
        },
      })
      await tx.adminActionLog.create({
        data: {
          adminId: normalized.operatorId,
          targetUserId: recipient.id,
          action: 'USER_REWARD',
          detail: {
            rewardId: reward.id,
            transactionId: reward.transactionId,
            experienceAmount: reward.experienceAmount,
            registrationFeeAmount: reward.registrationFeeAmount,
            reason: reward.reason,
            usernameSnapshot: reward.usernameSnapshot,
          },
          createdAt: reward.createdAt,
        },
      })

      return { duplicate: false, reward, user: updatedUser }
    })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error

    // A concurrent retry can lose the unique-key race after the original
    // transaction commits. Read the committed reward and return it as the
    // idempotent result; no balance or ledger write is repeated.
    const existing = await prisma.userReward.findUnique({ where: { transactionId: normalized.transactionId } })
    if (!existing) throw error
    assertIdempotencyMatch(existing, normalized)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.userId }, select: rewardUserSelect })
    return { duplicate: true, reward: existing, user }
  }
}
