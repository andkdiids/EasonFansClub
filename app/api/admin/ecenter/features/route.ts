import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import {
  getAdminEcenterFeatureSettings,
  getEcenterFeatureKeys,
  mergeEcenterFeatureSettings,
  validateEcenterFeatureUpdates,
} from '@/lib/ecenter-features'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('nav_manage')
  if (!guard.user) return guard.response
  return NextResponse.json({ features: await getAdminEcenterFeatureSettings() }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('nav_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ message: 'E院中心排序数据格式不正确' }, { status: 400 })

  const before = await getAdminEcenterFeatureSettings()
  const reset = (body as Record<string, unknown>).reset === true
  const validation = validateEcenterFeatureUpdates((body as Record<string, unknown>).features)
  if (!reset && 'error' in validation) return NextResponse.json({ message: validation.error }, { status: 400 })

  try {
    const keys = getEcenterFeatureKeys()
    await prisma.$transaction(async (tx) => {
      if (reset) {
        await tx.ecenterFeatureSetting.deleteMany({ where: { featureKey: { in: keys } } })
      } else if ('updates' in validation) {
        for (const feature of validation.updates) {
          await tx.ecenterFeatureSetting.upsert({
            where: { featureKey: feature.featureKey },
            update: { sortOrder: feature.sortOrder, isEnabled: feature.isEnabled },
            create: { featureKey: feature.featureKey, sortOrder: feature.sortOrder, isEnabled: feature.isEnabled },
          })
        }
      }

      const after = reset
        ? mergeEcenterFeatureSettings([])
        : mergeEcenterFeatureSettings([
            ...before.map(({ featureKey, sortOrder, isEnabled }) => ({ featureKey, sortOrder, isEnabled })),
            ...('updates' in validation ? validation.updates : []),
          ])
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'UPDATE_SETTING',
        operationType: adminAuditOperations.ECENTER_FEATURES_UPDATED,
        targetType: 'ECENTER_FEATURE_SETTINGS',
        targetId: 'ecenter',
        targetTitle: 'E院中心功能入口',
        reason: reset ? '恢复 E院中心默认配置' : '更新 E院中心功能入口排序与启用状态',
        metadata: {
          reset,
          before: before.map(({ featureKey, sortOrder, isEnabled }) => ({ featureKey, sortOrder, isEnabled })),
          after: after.map(({ featureKey, sortOrder, isEnabled }) => ({ featureKey, sortOrder, isEnabled })),
        },
      })
    })

    revalidatePath('/admin/ecenter-features')
    return NextResponse.json({
      message: reset ? 'E院中心已恢复默认配置' : 'E院中心功能入口设置已保存并立即生效',
      features: await getAdminEcenterFeatureSettings(),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.ecenter-features.update]', error)
    return NextResponse.json({ message: 'E院中心设置暂时无法保存，请确认数据库迁移已完成后重试' }, { status: 503 })
  }
}
