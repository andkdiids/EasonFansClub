import { NextResponse } from 'next/server'
import { getRecentSocialSyncLogs } from '@/lib/social-posts'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const logs = await getRecentSocialSyncLogs(50)
  return NextResponse.json({ logs: logs.map((log) => ({ ...log, errorMessage: log.errorMessage?.slice(0, 240) || null })) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
