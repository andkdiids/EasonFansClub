import { Prisma, type PrismaClient } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { activityRegistrationVerificationWhere, activityVerificationTokenFromInput, redeemActivityLinkedMaterialInTransaction, verifyActivityRegistrationInTransaction } from '@/lib/activity-registration'
import { getActivityLotteryWinnerRedemptionState, type ActivityLotteryCheckInSnapshot, type ActivityLotteryWinnerRedemptionState } from '@/lib/activity-lottery'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export const activityRedemptionEntitlementTypes = ['ACTIVITY_REGISTRATION', 'MATERIAL', 'LOTTERY_PRIZE'] as const
export type ActivityRedemptionEntitlementType = (typeof activityRedemptionEntitlementTypes)[number]

export type ActivityRedemptionSelection = { type: ActivityRedemptionEntitlementType; id: string }

export type ActivityRedemptionEntitlement = {
  type: ActivityRedemptionEntitlementType
  id: string
  title: string
  subtitle: string | null
  quantity: number
  status: 'PENDING' | 'REDEEMED' | 'UNAVAILABLE'
  redeemable: boolean
  selectable: boolean
  defaultSelected: boolean
  requires: ActivityRedemptionEntitlementType[]
  blockedReason: string | null
  redeemedAt: string | null
  redemptionState?: ActivityLotteryWinnerRedemptionState
}

export type ActivityRedemptionLookupView = {
  activity: { id: string; title: string }
  user: { uid: number; nickname: string; avatarUrl: string | null }
  entitlements: ActivityRedemptionEntitlement[]
}

export class ActivityRedemptionError extends Error {
  constructor(readonly code: 'INVALID_TOKEN' | 'REGISTRATION_NOT_FOUND' | 'REGISTRATION_CANCELLED' | 'ACTIVITY_CANCELLED' | 'NO_SELECTION' | 'INVALID_ENTITLEMENT' | 'LOTTERY_WINNER_WAITING_FOR_CHECK_IN' | 'LOTTERY_WINNER_EXPIRED' | 'REDEMPTION_FAILED', message: string, readonly status = 409) {
    super(message)
    this.name = 'ActivityRedemptionError'
  }
}

const lookupRegistrationSelect = {
  id: true,
  status: true,
  userId: true,
  verifiedAt: true,
  checkedInAt: true,
  checkInSource: true,
  LinkedMaterialRedemption: {
    select: {
      id: true,
      status: true,
      source: true,
      quantity: true,
      redeemedAt: true,
      material: { select: { title: true } },
    },
  },
  User: { select: { uid: true, nickname: true, avatarUrl: true, Profile: { select: { avatarUrl: true } } } },
  Activity: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true } },
} satisfies Prisma.ActivityRegistrationSelect

type LookupRegistration = Prisma.ActivityRegistrationGetPayload<{ select: typeof lookupRegistrationSelect }>

type ActivityRegistrationLookupDb = Pick<PrismaClient, 'activityRegistration'> | Pick<Prisma.TransactionClient, 'activityRegistration'>

function tokenFromInput(value: string) {
  const token = activityVerificationTokenFromInput(value)
  if (!token) throw new ActivityRedemptionError('INVALID_TOKEN', '活动核销码或二维码令牌无效', 400)
  return token
}

function selectionMetadata(selectable: boolean, requires: ActivityRedemptionEntitlementType[] = [], blockedReason: string | null = null) {
  return { selectable, defaultSelected: selectable, requires, blockedReason }
}

export async function resolveActivityVerificationToken(db: ActivityRegistrationLookupDb, activityId: string, rawToken: string) {
  const token = tokenFromInput(rawToken)
  const registration = await db.activityRegistration.findFirst({ where: activityRegistrationVerificationWhere(activityId, token), select: lookupRegistrationSelect })
  if (!registration) throw new ActivityRedemptionError('REGISTRATION_NOT_FOUND', '找不到对应的有效活动报名记录', 404)
  if (registration.Activity.status === 'CANCELLED') throw new ActivityRedemptionError('ACTIVITY_CANCELLED', '活动已取消，无法核销', 409)
  if (registration.status === 'CANCELLED') throw new ActivityRedemptionError('REGISTRATION_CANCELLED', '该报名已取消', 409)
  return { token, registration }
}

function materialEntitlement(registration: LookupRegistration, now: Date): ActivityRedemptionEntitlement | null {
  const order = registration.LinkedMaterialRedemption
  if (!order) return null
  const isPending = order.status === 'SUCCESS'
  const isRedeemed = order.status === 'REDEEMED'
  const isAvailableNow = !registration.Activity.startsAt || now >= registration.Activity.startsAt
  const selectable = isPending && isAvailableNow
  return {
    type: 'MATERIAL',
    id: order.id,
    title: order.material.title,
    subtitle: order.source === 'ACTIVITY_REGISTRATION_AUTO' && !isAvailableNow && isPending ? '活动尚未开始' : '活动物料',
    quantity: order.quantity,
    status: isPending ? 'PENDING' : isRedeemed ? 'REDEEMED' : 'UNAVAILABLE',
    redeemable: selectable,
    ...selectionMetadata(selectable, [], !isPending ? '当前不可核销' : !isAvailableNow ? '活动尚未开始，暂不能核销活动物料' : null),
    redeemedAt: order.redeemedAt?.toISOString() || null,
  }
}

async function loadLookupRows(activityId: string, token: string) {
  const { registration } = await resolveActivityVerificationToken(prisma, activityId, token)
  const winners = await prisma.lotteryEntry.findMany({
    where: { userId: registration.userId, Lottery: { activityId, status: 'DRAWN' } },
    orderBy: [{ wonAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      registrationId: true,
      redemptionStatus: true,
      redeemedAt: true,
      Lottery: { select: { title: true } },
       LotteryPrize: { select: { tierName: true, name: true, prizeType: true } },
      Registration: { select: { id: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true } },
    },
  })
  // Virtual prizes are fulfilled automatically after the draw and must never
  // enter the physical check-in/redemption flow.
  return { registration, winners: winners.filter((winner) => winner.LotteryPrize?.prizeType !== 'VIRTUAL') }
}

function lotteryWinnerRegistration(registration: LookupRegistration, winner: { registrationId: string | null; Registration: ActivityLotteryCheckInSnapshot | null }) {
  if (!winner.registrationId || winner.registrationId === registration.id) return registration
  return winner.Registration
}

function lotteryWinnerSubtitle(state: ActivityLotteryWinnerRedemptionState) {
  if (state === 'REDEEMED') return '已兑奖'
  if (state === 'REDEEMABLE') return '已中奖 · 可兑奖'
  if (state === 'EXPIRED') return '已失效：未在活动结束前完成真实现场核销'
  return '已中奖 · 需完成活动签到后兑奖，可与活动签到一并核销'
}

export async function getActivityRedemptionLookup(activityId: string, rawToken: string): Promise<ActivityRedemptionLookupView> {
  const { registration, winners } = await loadLookupRows(activityId, rawToken)
  const now = new Date()
  const registrationSelectable = !registration.verifiedAt
  const material = materialEntitlement(registration, now)
  const entitlements: ActivityRedemptionEntitlement[] = [
    {
      type: 'ACTIVITY_REGISTRATION',
      id: registration.id,
      title: '活动签到',
      subtitle: registration.verifiedAt ? '已完成活动核销' : '活动报名资格',
      quantity: 1,
      status: registration.verifiedAt ? 'REDEEMED' : 'PENDING',
      redeemable: registrationSelectable,
      ...selectionMetadata(registrationSelectable),
      redeemedAt: registration.verifiedAt?.toISOString() || null,
    },
    ...(material ? [material] : []),
    ...winners.map((winner) => {
      const redemptionState = getActivityLotteryWinnerRedemptionState({
        redemptionStatus: winner.redemptionStatus,
        registration: lotteryWinnerRegistration(registration, winner),
        activityEndAt: registration.Activity.endsAt,
        now,
      })
      return {
        type: 'LOTTERY_PRIZE' as const,
        id: winner.id,
        title: winner.LotteryPrize ? `${winner.LotteryPrize.tierName || '中奖奖项'} · ${winner.LotteryPrize.name}` : '中奖奖品',
        subtitle: `${winner.Lottery.title} · ${lotteryWinnerSubtitle(redemptionState)}`,
        quantity: 1,
        status: redemptionState === 'REDEEMED' ? 'REDEEMED' as const : redemptionState === 'EXPIRED' ? 'UNAVAILABLE' as const : 'PENDING' as const,
        redeemable: redemptionState === 'REDEEMABLE',
        ...selectionMetadata(
          redemptionState === 'WAITING_FOR_CHECK_IN' || redemptionState === 'REDEEMABLE',
          ['ACTIVITY_REGISTRATION'],
          redemptionState === 'WAITING_FOR_CHECK_IN'
            ? '需完成活动签到，可与活动签到一并核销'
            : redemptionState === 'EXPIRED'
              ? '已失效，无法兑奖'
              : redemptionState === 'REDEEMED'
                ? '已兑奖，不能重复核销'
                : null,
        ),
        redemptionState,
        redeemedAt: winner.redeemedAt?.toISOString() || null,
      }
    }),
  ]
  return {
    activity: { id: registration.Activity.id, title: registration.Activity.title },
    user: { uid: registration.User.uid, nickname: registration.User.nickname, avatarUrl: publicImageUrl(registration.User.Profile?.avatarUrl || registration.User.avatarUrl) },
    entitlements,
  }
}

function assertSelection(value: unknown): ActivityRedemptionSelection[] {
  if (!Array.isArray(value)) throw new ActivityRedemptionError('NO_SELECTION', '请选择至少一项待核销权益', 400)
  const selections: ActivityRedemptionSelection[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '核销项目格式不正确', 400)
    const record = item as Record<string, unknown>
    const type = typeof record.type === 'string' && activityRedemptionEntitlementTypes.includes(record.type as ActivityRedemptionEntitlementType) ? record.type as ActivityRedemptionEntitlementType : null
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!type || !id || id.length > 191) throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '核销项目无效', 400)
    const key = `${type}:${id}`
    if (!seen.has(key)) {
      selections.push({ type, id })
      seen.add(key)
    }
  }
  if (!selections.length) throw new ActivityRedemptionError('NO_SELECTION', '请选择至少一项待核销权益', 400)
  return selections
}

const activityRedemptionProcessingOrder: Record<ActivityRedemptionEntitlementType, number> = {
  ACTIVITY_REGISTRATION: 0,
  MATERIAL: 1,
  LOTTERY_PRIZE: 2,
}

export function orderActivityRedemptionSelections(selections: readonly ActivityRedemptionSelection[]) {
  return selections
    .map((selection, index) => ({ selection, index }))
    .sort((left, right) => activityRedemptionProcessingOrder[left.selection.type] - activityRedemptionProcessingOrder[right.selection.type] || left.index - right.index)
    .map(({ selection }) => selection)
}

async function lockRegistration(tx: Prisma.TransactionClient, activityId: string, token: string) {
  const { registration } = await resolveActivityVerificationToken(tx, activityId, token)
  await tx.$queryRaw`SELECT \`id\` FROM \`ActivityRegistration\` WHERE \`id\` = ${registration.id} FOR UPDATE`
  return readLockedRegistration(tx, registration.id)
}

const lockedRegistrationSelect = {
  id: true,
  status: true,
  userId: true,
  verifiedAt: true,
  checkedInAt: true,
  checkInSource: true,
  linkedMaterialRedemptionId: true,
  Activity: { select: { status: true, endsAt: true } },
} satisfies Prisma.ActivityRegistrationSelect

type LockedActivityRegistration = Prisma.ActivityRegistrationGetPayload<{ select: typeof lockedRegistrationSelect }>

async function readLockedRegistration(tx: Prisma.TransactionClient, registrationId: string) {
  const current = await tx.activityRegistration.findUnique({ where: { id: registrationId }, select: lockedRegistrationSelect })
  if (!current) throw new ActivityRedemptionError('REGISTRATION_NOT_FOUND', '报名记录不存在', 404)
  if (current.Activity.status === 'CANCELLED') throw new ActivityRedemptionError('ACTIVITY_CANCELLED', '活动已取消，无法核销', 409)
  if (current.status === 'CANCELLED') throw new ActivityRedemptionError('REGISTRATION_CANCELLED', '该报名已取消', 409)
  return current
}

async function redeemLotteryWinnerInTransaction(
  tx: Prisma.TransactionClient,
  activityId: string,
  winnerId: string,
  registration: LockedActivityRegistration,
  adminId: string,
  now: Date,
) {
  await tx.$queryRaw`SELECT \`id\` FROM \`LotteryEntry\` WHERE \`id\` = ${winnerId} FOR UPDATE`
  const winner = await tx.lotteryEntry.findFirst({
    where: { id: winnerId, userId: registration.userId, Lottery: { activityId, status: 'DRAWN' } },
    select: { id: true, registrationId: true, redemptionStatus: true, redeemedAt: true, LotteryPrize: { select: { prizeType: true } } },
  })
  if (!winner) throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '中奖奖品不属于当前活动或当前用户', 403)
  if (winner.LotteryPrize?.prizeType === 'VIRTUAL') throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '虚拟奖品已自动发放，无需现场兑奖', 409)
  if (winner.registrationId && winner.registrationId !== registration.id) throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '中奖奖品不属于当前活动报名记录', 403)
  if (winner.redemptionStatus === 'REDEEMED') return { id: winner.id, status: 'ALREADY_REDEEMED' as const, redeemedAt: winner.redeemedAt?.toISOString() || null }
  const redemptionState = getActivityLotteryWinnerRedemptionState({ redemptionStatus: winner.redemptionStatus, registration, activityEndAt: registration.Activity.endsAt, now })
  if (redemptionState === 'WAITING_FOR_CHECK_IN') throw new ActivityRedemptionError('LOTTERY_WINNER_WAITING_FOR_CHECK_IN', '该奖品需要完成活动签到后才能兑奖，请同时勾选活动签到', 409)
  if (redemptionState === 'EXPIRED') throw new ActivityRedemptionError('LOTTERY_WINNER_EXPIRED', '该中奖资格已失效，未在活动结束前完成真实现场核销', 409)
  const updated = await tx.lotteryEntry.updateMany({ where: { id: winner.id, userId: registration.userId, redemptionStatus: 'PENDING' }, data: { redemptionStatus: 'REDEEMED', redeemedAt: now, redeemedByAdminId: adminId } })
  if (updated.count !== 1) {
    const latest = await tx.lotteryEntry.findUnique({ where: { id: winner.id }, select: { redemptionStatus: true, redeemedAt: true } })
    if (latest?.redemptionStatus === 'REDEEMED') return { id: winner.id, status: 'ALREADY_REDEEMED' as const, redeemedAt: latest.redeemedAt?.toISOString() || null }
    throw new ActivityRedemptionError('REDEMPTION_FAILED', '中奖奖品核销状态发生变化，请刷新后重试', 409)
  }
  return { id: winner.id, status: 'REDEEMED' as const, redeemedAt: now.toISOString() }
}

export async function confirmActivityRedemption(activityId: string, rawToken: string, rawSelections: unknown, adminId: string) {
  const token = tokenFromInput(rawToken)
  const selections = assertSelection(rawSelections)
  const orderedSelections = orderActivityRedemptionSelections(selections)
  const transactionResult = await prisma.$transaction(async (tx) => {
    const lockedActivity = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
    if (!lockedActivity.length) throw new ActivityRedemptionError('REGISTRATION_NOT_FOUND', '活动不存在', 404)
    let registration = await lockRegistration(tx, activityId, token)
    const now = new Date()
    const itemResults: Array<{ type: ActivityRedemptionEntitlementType; id: string; status: 'REDEEMED' | 'ALREADY_REDEEMED' }> = []
    for (const selection of orderedSelections) {
      if (selection.type === 'ACTIVITY_REGISTRATION') {
        if (selection.id !== registration.id) throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '活动报名权益不属于当前二维码', 403)
        const result = await verifyActivityRegistrationInTransaction(tx, { activityId, token, adminId, method: 'QR', redeemLinkedMaterial: false }, now)
        registration = await readLockedRegistration(tx, registration.id)
        itemResults.push({ type: selection.type, id: selection.id, status: result.alreadyVerified ? 'ALREADY_REDEEMED' : 'REDEEMED' })
      } else if (selection.type === 'MATERIAL') {
        if (selection.id !== registration.linkedMaterialRedemptionId) throw new ActivityRedemptionError('INVALID_ENTITLEMENT', '活动物料不属于当前二维码', 403)
        const result = await redeemActivityLinkedMaterialInTransaction(tx, { activityId, registrationId: registration.id, orderId: selection.id, adminId }, now)
        itemResults.push({ type: selection.type, id: selection.id, status: result.changed ? 'REDEEMED' : 'ALREADY_REDEEMED' })
      } else {
        const result = await redeemLotteryWinnerInTransaction(tx, activityId, selection.id, registration, adminId, now)
        itemResults.push({ type: selection.type, id: selection.id, status: result.status === 'REDEEMED' ? 'REDEEMED' : 'ALREADY_REDEEMED' })
      }
    }
    await createAdminActionAudit(tx, {
      operatorId: adminId,
      action: 'UPDATE_SETTING',
      operationType: adminAuditOperations.ACTIVITY_REDEMPTION_CONFIRM,
      targetType: 'ACTIVITY_REDEMPTION',
      targetId: registration.id,
      targetUserId: registration.userId,
      metadata: { activityId, registrationId: registration.id, selections: itemResults } as Prisma.InputJsonValue,
    })
    return { itemResults, registrationId: registration.id }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000, maxWait: 5_000 })
  try {
    const { grantEligibleActivityBadges } = await import('@/lib/activity-badge-rewards')
    await grantEligibleActivityBadges({ activityId, registrationId: transactionResult.registrationId })
  } catch (error) {
    // The redemption transaction is already committed; the global scanner is
    // the durable retry path if badge issuance is temporarily unavailable.
    console.error('[activity.redemption.badge-reward]', { activityId, registrationId: transactionResult.registrationId, error })
  }
  const lookup = await getActivityRedemptionLookup(activityId, token)
  return { ...lookup, results: transactionResult.itemResults }
}
