import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { MANUAL_POST_DELETE_RATE_LIMIT_POLICY } from '@/lib/anywhere-door/manual-post-policy'
import { acquireInstagramSyncLease, getInstagramSyncState, releaseInstagramSyncLease } from '@/lib/instagram/sync-state'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export const runtime = 'nodejs'

const MANUAL_POST_AUDIT_OPERATIONS = [
  adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_CREATED,
  adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_RECOVERED,
]

export async function DELETE(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, MANUAL_POST_DELETE_RATE_LIMIT_POLICY, '删除补录操作过于频繁，请稍后再试')
  if (limited) return limited

  const { postId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ code: 'MANUAL_POST_NOT_FOUND', message: '手动补录内容不存在' }, { status: 404 })

  let leaseToken: string | null = null
  try {
    await getInstagramSyncState(ANYWHERE_DOOR_TARGET)
    const lease = await acquireInstagramSyncLease({ target: ANYWHERE_DOOR_TARGET })
    if (!lease.acquired) return NextResponse.json({ code: 'SYNC_BUSY', message: '自动同步正在处理，请稍后再试' }, { status: 409 })
    leaseToken = lease.token

    const post = await prisma.socialPost.findFirst({
      where: { id: postId, platform: 'INSTAGRAM', authorUsername: ANYWHERE_DOOR_TARGET, provider: 'manual' },
      select: { id: true, caption: true, media: { select: { storageUrl: true } } },
    })
    if (!post) return NextResponse.json({ code: 'MANUAL_POST_NOT_FOUND', message: '手动补录内容不存在' }, { status: 404 })

    const manualAudit = await prisma.adminAction.findFirst({
      where: { targetType: 'SOCIAL_POST', targetId: post.id, operationType: { in: MANUAL_POST_AUDIT_OPERATIONS } },
      select: { id: true },
    })
    if (!manualAudit) return NextResponse.json({ code: 'MANUAL_POST_NOT_FOUND', message: '该动态没有可验证的手动补录记录，未删除' }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await createAdminActionAudit(tx, {
        operatorId: guard.user!.id,
        action: 'DELETE_POST',
        operationType: adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_DELETED,
        targetType: 'SOCIAL_POST',
        targetId: post.id,
        targetTitle: post.caption?.slice(0, 160) || '随意门动态',
        reason: '管理员删除指定手动补录动态',
        metadata: { sourceMode: 'MANUAL', mediaCount: post.media.length },
      })
      await tx.socialPostComment.deleteMany({ where: { postId: post.id, parentId: { not: null } } })
      await tx.socialPostComment.deleteMany({ where: { postId: post.id, parentId: null } })
      const deleted = await tx.socialPost.deleteMany({
        where: { id: post.id, platform: 'INSTAGRAM', authorUsername: ANYWHERE_DOOR_TARGET, provider: 'manual' },
      })
      if (deleted.count !== 1) throw new Error('MANUAL_POST_DELETE_CONFLICT')
    })

    try {
      revalidatePath('/anywhere-door')
      revalidatePath('/api/anywhere-door')
    } catch (error) {
      console.error('[admin.anywhere-door.manual.delete.revalidate]', { errorName: error instanceof Error ? error.name : 'unknown' })
    }
    return NextResponse.json({ deleted: true, postId: post.id, cosObjectsPreserved: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.anywhere-door.manual.delete]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ code: 'MANUAL_POST_DELETE_FAILED', message: '删除失败；内容状态未确认，请刷新记录后再操作' }, { status: 503 })
  } finally {
    if (leaseToken) await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, leaseToken).catch(() => false)
  }
}
