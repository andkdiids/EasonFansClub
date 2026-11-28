import type { Prisma } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { DEFAULT_LIVE_PHOTO_CONFIG, LIVE_PHOTO_CONFIG_KEY, normalizeLivePhotoConfig, publicLivePhotoConfig, type LivePhotoConfig } from '@/lib/live-photo-config'
import { prisma } from '@/lib/prisma'

export async function getLivePhotoConfig(): Promise<LivePhotoConfig> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: LIVE_PHOTO_CONFIG_KEY },
    select: { value: true },
  })
  if (!row?.value) return DEFAULT_LIVE_PHOTO_CONFIG
  try {
    return normalizeLivePhotoConfig(JSON.parse(row.value))
  } catch {
    return DEFAULT_LIVE_PHOTO_CONFIG
  }
}

export async function saveLivePhotoConfig(config: LivePhotoConfig, adminId: string, reason: string) {
  const normalized = normalizeLivePhotoConfig(config)
  await prisma.$transaction(async (tx) => {
    const before = await tx.siteSetting.findUnique({ where: { key: LIVE_PHOTO_CONFIG_KEY }, select: { value: true } })
    await tx.siteSetting.upsert({
      where: { key: LIVE_PHOTO_CONFIG_KEY },
      update: {
        value: JSON.stringify(normalized),
        valueType: 'JSON',
        group: 'media',
        label: '实况照片媒体配置',
      },
      create: {
        key: LIVE_PHOTO_CONFIG_KEY,
        value: JSON.stringify(normalized),
        valueType: 'JSON',
        group: 'media',
        label: '实况照片媒体配置',
      },
    })
    await createAdminActionAudit(tx, {
      operatorId: adminId,
      action: 'UPDATE_SETTING',
      operationType: adminAuditOperations.LIVE_PHOTO_CONFIG_UPDATED,
      targetType: 'LIVE_PHOTO_CONFIG',
      targetId: LIVE_PHOTO_CONFIG_KEY,
      targetTitle: '实况照片媒体配置',
      reason,
      metadata: {
        before: before?.value ? JSON.parse(before.value) as Prisma.InputJsonValue : null,
        after: publicLivePhotoConfig(normalized) as Prisma.InputJsonValue,
      },
    })
  })
  return normalized
}
