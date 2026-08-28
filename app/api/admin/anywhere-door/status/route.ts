import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security'
import { getInstagramProviderStatus } from '@/lib/instagram/factory'
import { getRecentSocialSyncLogs } from '@/lib/social-posts'
import { getAnywhereDoorConfig } from '@/lib/anywhere-door/config'
import { findInstagramSyncState } from '@/lib/instagram/sync-state'
import { runAnywhereDoorProductionPreflight } from '@/lib/instagram/production-preflight'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  try {
    const config = getAnywhereDoorConfig()
    const [logs, syncState] = await Promise.all([
      getRecentSocialSyncLogs(10),
      findInstagramSyncState().catch(() => null),
    ])
    let providerStatus: Record<string, unknown> | null = null
    try {
      providerStatus = getInstagramProviderStatus()
    } catch {
      providerStatus = {
        provider: 'CONFIG_ERROR', target: config.target, proxyConfigured: false, proxyType: null,
        mediaProxyConfigured: false, mediaProxyType: null,
        directFallback: false, browserEnabled: false, brightDataConfigured: false,
        apifyConfigured: Boolean(process.env.APIFY_API_TOKEN?.trim()), sessionStateConfigured: false,
      }
    }
    const alerts = [...(config.storageModeError ? ['invalid production configuration'] : [])]
    if (process.env.NODE_ENV === 'production') {
      const preflight = runAnywhereDoorProductionPreflight()
      alerts.push(...preflight.issues)
    }
    if (syncState) {
      if (syncState.consecutiveFailures >= 3) alerts.push('连续同步失败达到 3 次')
      if (syncState.lastErrorCode === 'PROVIDER_AUTH_ERROR') alerts.push('Provider 鉴权失败')
      if (syncState.lastErrorCode === 'COS_ERROR') alerts.push('COS 归档失败')
      if (syncState.lastErrorCode === 'DB_ERROR') alerts.push('数据库同步失败')
      if (!syncState.lastSuccessfulSyncAt || Date.now() - syncState.lastSuccessfulSyncAt.getTime() > 24 * 60 * 60 * 1000) alerts.push('超过 24 小时没有成功检查')
    }
    const status = {
      ...providerStatus,
      enabled: config.enabled,
      syncEnabled: config.syncEnabled,
      notificationEnabled: config.notificationEnabled,
      storageMode: config.storageMode,
      syncState: syncState ? {
        lastCheckedAt: syncState.lastCheckedAt?.toISOString() || null,
        lastSuccessfulSyncAt: syncState.lastSuccessfulSyncAt?.toISOString() || null,
        lastChangedAt: syncState.lastChangedAt?.toISOString() || null,
        nextAllowedSyncAt: syncState.nextAllowedSyncAt?.toISOString() || null,
        consecutiveFailures: syncState.consecutiveFailures,
        lastErrorCode: syncState.lastErrorCode,
        baselineCompletedAt: syncState.baselineCompletedAt?.toISOString() || null,
      } : null,
      alerts: [...new Set(alerts)],
    }
    return NextResponse.json({ status, logs: logs.map((log) => ({ ...log, errorMessage: log.errorMessage?.slice(0, 240) || null })) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.anywhere-door.status]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '随意门状态暂时无法加载' }, { status: 503 })
  }
}
