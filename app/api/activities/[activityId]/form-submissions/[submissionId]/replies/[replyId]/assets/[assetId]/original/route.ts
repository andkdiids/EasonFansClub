import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireRequestUser } from '@/lib/security'
import { isTopicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'
import { downloadTopicActivityOriginal } from '@/lib/topic-activity-image-download'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ activityId: string; submissionId: string; replyId: string; assetId: string }> }

const ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/u

function denied() {
  // Do not distinguish a guessed asset id, a wrong relation, or another
  // user's submission. This keeps the object key and signed URL private.
  return NextResponse.json({ message: '原图不存在' }, { status: 404, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, submissionId, replyId, assetId } = await context.params
  if (![activityId, submissionId, replyId, assetId].every((value) => ID_PATTERN.test(value))) return denied()

  // Resolve each relation independently. Besides making the ownership check
  // explicit, this prevents a valid id from being reused under another
  // activity/submission/reply path.
  const submission = await prisma.topicActivityFormSubmission.findFirst({
    where: { id: submissionId, activityId },
    select: { id: true, activityId: true, userId: true },
  })
  if (!submission) return denied()
  const reply = await prisma.topicActivitySubmissionReply.findFirst({
    where: { id: replyId, submissionId: submission.id },
    select: { id: true, submissionId: true },
  })
  if (!reply) return denied()
  const asset = await prisma.topicActivityImageAsset.findFirst({
    where: { id: assetId, activityId, replyId: reply.id, purpose: 'ADMIN_REPLY' },
    select: { id: true, storageKey: true, mimeType: true, size: true },
  })
  if (!asset || !isTopicActivityOriginalObjectKey(asset.storageKey, activityId, 'ADMIN_REPLY')) return denied()

  const isOwner = submission.userId === guard.user.id
  const isAdmin = await hasAdminPermission(guard.user, 'activity_manage').catch(() => false)
  if (!isOwner && !isAdmin) return denied()

  return downloadTopicActivityOriginal(asset, `${activityId}-${submissionId}-${replyId}`, { activityId, submissionId, replyId, assetId }, new URL(request.url).searchParams.get('view') === '1' ? 'inline' : 'attachment')
}
