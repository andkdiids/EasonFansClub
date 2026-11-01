import { NextResponse } from 'next/server'
import { getRecentSocialSyncLogs } from '@/lib/social-posts'
import { requireAdmin } from '@/lib/security'
import { safeSyncErrorCode, safeSyncErrorMessage } from '@/lib/instagram/safe-sync-status'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const logs = await getRecentSocialSyncLogs(50)
  return NextResponse.json({ logs: logs.map((log) => ({
    ...log,
    errorCode: safeSyncErrorCode(log.errorCode),
    errorMessage: safeSyncErrorMessage(log.errorCode),
  })) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
