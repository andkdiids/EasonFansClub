import { Prisma } from '@prisma/client'

export const ACTIVITY_MATERIAL_RULE = 'ACTIVITY_REGISTRATION_REQUIRED' as const

export class ActivityMaterialConfigurationError extends Error {
  constructor(readonly message: string) {
    super(message)
    this.name = 'ActivityMaterialConfigurationError'
  }
}

type ActivityMaterialDb = Pick<Prisma.TransactionClient, 'activity' | 'materialRedemption' | 'materialRedemptionRule'>

export function isActivityMaterialRule(value: unknown): value is typeof ACTIVITY_MATERIAL_RULE {
  return value === ACTIVITY_MATERIAL_RULE
}

export function activityMaterialSchedule(startsAt: Date | null | undefined, endsAt: Date | null | undefined) {
  if (!startsAt || !endsAt || startsAt >= endsAt) return null
  return { exchangeStartAt: startsAt, exchangeEndAt: endsAt, redeemEndAt: endsAt }
}

/**
 * Keeps the one-material-per-activity binding and the material's inherited
 * activity schedule in one transaction. Existing DEFAULT materials are never
 * silently converted; an administrator must explicitly choose the new rule in
 * the material editor first.
 */
export async function syncActivityLinkedMaterial(
  tx: ActivityMaterialDb,
  input: { activityId: string; linkedMaterialId: string | null; startsAt: Date | null; endsAt: Date | null },
) {
  const previous = await tx.materialRedemption.findFirst({
    where: { linkedActivityId: input.activityId },
    select: { id: true },
  })

  if (!input.linkedMaterialId) {
    if (previous) {
      await tx.materialRedemption.update({ where: { id: previous.id }, data: { linkedActivityId: null, redemptionRule: 'DEFAULT' } })
      await tx.materialRedemptionRule.deleteMany({ where: { materialId: previous.id, type: ACTIVITY_MATERIAL_RULE } })
    }
    return null
  }

  const material = await tx.materialRedemption.findUnique({
    where: { id: input.linkedMaterialId },
    select: { id: true, title: true, redemptionRule: true, linkedActivityId: true },
  })
  if (!material) throw new ActivityMaterialConfigurationError('绑定的活动物料不存在')
  if (material.redemptionRule !== ACTIVITY_MATERIAL_RULE) {
    throw new ActivityMaterialConfigurationError('请先在物料管理中选择“需报名指定活动”，再绑定到活动')
  }
  if (material.linkedActivityId && material.linkedActivityId !== input.activityId) {
    throw new ActivityMaterialConfigurationError('该物料已经绑定其他活动')
  }
  if (previous && previous.id !== material.id) {
    throw new ActivityMaterialConfigurationError('一个活动只能绑定一个活动物料')
  }
  const schedule = activityMaterialSchedule(input.startsAt, input.endsAt)
  if (!schedule) throw new ActivityMaterialConfigurationError('绑定活动物料前请先设置有效的活动开始和结束时间')

  await tx.materialRedemption.update({
    where: { id: material.id },
    data: { linkedActivityId: input.activityId, ...schedule },
  })
  await tx.materialRedemptionRule.deleteMany({ where: { materialId: material.id, type: ACTIVITY_MATERIAL_RULE } })
  await tx.materialRedemptionRule.create({
    data: { materialId: material.id, type: ACTIVITY_MATERIAL_RULE, operator: 'EQ', value: input.activityId, sortOrder: 0 },
  })
  return { id: material.id, title: material.title }
}
