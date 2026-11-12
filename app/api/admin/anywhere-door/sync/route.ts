import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireAdmin, enforceApiRateLimit } from '@/lib/security'
import { isAnywhereDoorSyncEnabled, ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { prisma } from '@/lib/prisma'
import { InstagramAdmissionUnavailableError, withInstagramWorkerAdmission } from '@/lib/instagram/maintenance-protocol'
import { acquireInstagramSyncLease, getInstagramSyncState, releaseInstagramSyncLease, requestInstagramSync } from '@/lib/instagram/sync-state'

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
    const outcome = await withInstagramWorkerAdmission(prisma, ANYWHERE_DOOR_TARGET, async () => {
      const lease = await acquireInstagramSyncLease({ target: ANYWHERE_DOOR_TARGET })
      if (!lease.acquired || lease.generation === null) throw new Error('INSTAGRAM_SYNC_BUSY')
      try {
        const state = await getInstagramSyncState(ANYWHERE_DOOR_TARGET)
        if (baseline && state.baselineCompletedAt) return { kind: 'baseline-completed' as const }
        const requested = await requestInstagramSync({
          target: ANYWHERE_DOOR_TARGET,
          requestedAt: new Date(),
          lease: {
            target: ANYWHERE_DOOR_TARGET,
            token: lease.token,
            generation: lease.generation,
            assertActive: () => undefined,
          },
        })
        return { kind: 'requested' as const, requestedAt: requested.syncRequestedAt }
      } finally {
        await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, lease.token, lease.generation, prisma).catch(() => false)
      }
    })
    if (outcome.kind === 'baseline-completed') {
      return NextResponse.json({ code: 'BASELINE_ALREADY_COMPLETED', message: '首次初始化已经完成，如需再次执行请先确认并使用专用流程' }, { status: 409 })
    }
    return NextResponse.json({ result: { status: 'SYNC_REQUESTED', baseline, requestedAt: outcome.requestedAt } }, { status: 202, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof InstagramAdmissionUnavailableError || (error instanceof Error && error.message === 'INSTAGRAM_SYNC_BUSY')) {
      return NextResponse.json({ code: 'SYNC_BUSY', message: '当前同步正在运行或系统正在维护，请稍后重试' }, { status: 409 })
    }
    console.error('[admin.anywhere-door.sync.request]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '同步请求暂时无法登记，请确认状态表已准备' }, { status: 503 })
  }
}
