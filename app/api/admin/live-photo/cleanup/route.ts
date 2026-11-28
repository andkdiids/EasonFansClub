import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { cleanupOrphanLivePhotos } from '@/lib/live-photo-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cron-safe endpoint. Callers must present an administrator session/token. */
export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'site_config_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => ({}))
  const maxAgeHours = typeof body?.maxAgeHours === 'number' ? body.maxAgeHours : 24
  const cleaned = await cleanupOrphanLivePhotos(maxAgeHours)
  await prisma.$transaction((tx) => createAdminActionAudit(tx, {
    operatorId: guard.user.id,
    action: 'UPDATE_SETTING',
    operationType: adminAuditOperations.LIVE_PHOTO_CLEANUP,
    targetType: 'LIVE_PHOTO_ASSET',
    targetId: 'orphan-sweep',
    targetTitle: '实况照片无引用资源清理',
    reason: `清理 ${maxAgeHours} 小时前未被引用的媒体资源`,
    metadata: { cleanedCount: cleaned.length, assetIds: cleaned.map((id) => id.slice(0, 24)) },
  }))
  return NextResponse.json({ cleaned: cleaned.length, assetIds: cleaned })
}
