import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import { downloadTopicActivityOriginal } from '@/lib/topic-activity-image-download'
import { isTopicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ activityId: string; submissionId: string; assetId: string }> }

const ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/u

function denied() {
  // Do not distinguish a guessed asset id, a wrong relation, or another
  // user's submission. This keeps the object key and signed URL private.
  return NextResponse.json({ message: '原图不存在' }, { status: 404, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, submissionId, assetId } = await context.params
  if (![activityId, submissionId, assetId].every((value) => ID_PATTERN.test(value))) return denied()

  // Resolve submission and asset together by their explicit foreign-key
  // relation. A valid asset id must not be reusable under another submission
  // or activity path.
  const submission = await prisma.topicActivityFormSubmission.findFirst({
    where: { id: submissionId, activityId },
    select: { id: true, activityId: true, userId: true },
  })
  if (!submission) return denied()
  const asset = await prisma.topicActivityImageAsset.findFirst({
    where: { id: assetId, activityId, formSubmissionId: submission.id, replyId: null, purpose: 'FORM_ANSWER' },
    select: { id: true, storageKey: true, mimeType: true, size: true },
  })
  if (!asset || !isTopicActivityOriginalObjectKey(asset.storageKey, activityId, 'FORM_ANSWER')) return denied()

  const isOwner = submission.userId === guard.user.id
  const isAdmin = await hasAdminPermission(guard.user, 'activity_manage').catch(() => false)
  if (!isOwner && !isAdmin) return denied()

  return downloadTopicActivityOriginal(asset, `${activityId}-${submissionId}`, { activityId, submissionId, assetId })
}
