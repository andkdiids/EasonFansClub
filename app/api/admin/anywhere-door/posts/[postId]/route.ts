import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { acquireInstagramSyncLease, releaseInstagramSyncLease, withInstagramLeaseTransaction } from '@/lib/instagram/sync-state'
import { withInstagramWorkerAdmission } from '@/lib/instagram/maintenance-protocol'

type RouteContext = { params: Promise<{ postId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const body = await request.json().catch(() => null)
  const status = body?.status
  if (!['READY', 'HIDDEN', 'FAILED'].includes(status)) return NextResponse.json({ message: '状态无效' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
  return withInstagramWorkerAdmission(prisma, ANYWHERE_DOOR_TARGET, async () => {
    const lease = await acquireInstagramSyncLease({ target: ANYWHERE_DOOR_TARGET })
    if (!lease.acquired) return NextResponse.json({ code: 'SYNC_BUSY', message: '同步任务正在处理，请稍后重试' }, { status: 409 })
    if (lease.generation === null) return NextResponse.json({ code: 'LEASE_STATE_INVALID', message: '同步状态暂不可用，请稍后重试' }, { status: 503 })
    try {
      const updated = await withInstagramLeaseTransaction({ target: ANYWHERE_DOOR_TARGET, token: lease.token, generation: lease.generation }, async (tx) => {
        const post = await tx.socialPost.findUnique({ where: { id: postId }, select: { id: true } })
        if (!post) return null
        return tx.socialPost.update({ where: { id: postId }, data: { status }, select: { id: true, status: true } })
      })
      if (!updated) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
      return NextResponse.json({ post: updated })
    } finally {
      await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, lease.token, lease.generation).catch(() => false)
    }
  })
}
