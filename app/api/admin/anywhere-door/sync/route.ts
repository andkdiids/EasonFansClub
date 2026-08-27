import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireAdmin, enforceApiRateLimit } from '@/lib/security'
import { isAnywhereDoorSyncEnabled } from '@/lib/anywhere-door/config'
import { getInstagramSyncState, requestInstagramSync } from '@/lib/instagram/sync-state'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/anywhere-door/sync:POST',
    ip: { limit: 5, windowSeconds: 15 * 60 },
    user: { limit: 3, windowSeconds: 15 * 60 },
  })
  if (limited) return limited
  const body = await request.json().catch(() => null)
  const baseline = body && typeof body === 'object' && 'baseline' in body ? body.baseline === true : true
  if (!isAnywhereDoorSyncEnabled()) {
    return NextResponse.json({ code: 'SYNC_DISABLED', message: '随意门同步当前已关闭' }, { status: 409 })
  }
  try {
    const state = await getInstagramSyncState()
    if (baseline && state.baselineCompletedAt) {
      return NextResponse.json({ code: 'BASELINE_ALREADY_COMPLETED', message: '首次初始化已经完成，如需再次执行请先确认并使用专用流程' }, { status: 409 })
    }
    const requested = await requestInstagramSync()
    return NextResponse.json({ result: { status: 'SYNC_REQUESTED', baseline, requestedAt: requested.syncRequestedAt } }, { status: 202, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.anywhere-door.sync.request]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '同步请求暂时无法登记，请确认状态表已准备' }, { status: 503 })
  }
}
