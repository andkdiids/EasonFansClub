import { requireRequestUser } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { downloadTopicActivityOriginal } from '@/lib/topic-activity-image-download'
import { isTopicActivityOriginalObjectKey } from '@/lib/topic-activity-image-original'
import { topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ activityId: string; submissionId: string; assetId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, submissionId, assetId } = await context.params
  const denied = () => topicV2Json({ message: '原图不存在' }, 404)
  if (![activityId, submissionId, assetId].every((id) => topicV2IdPattern.test(id))) return denied()
  const submission = await prisma.topicActivitySubmission.findFirst({ where: { id: submissionId, activityId, rewardEntryId: { not: null } }, select: { userId: true } })
  if (!submission || (submission.userId !== guard.user.id && !await hasAdminPermission(guard.user, 'activity_manage'))) return denied()
  const asset = await prisma.topicActivityImageAsset.findFirst({ where: { id: assetId, activityId, taskSubmissionId: submissionId, purpose: 'FORM_ANSWER', formSubmissionId: null, replyId: null }, select: { storageKey: true, mimeType: true, size: true } })
  if (!asset || !isTopicActivityOriginalObjectKey(asset.storageKey, activityId, 'FORM_ANSWER')) return denied()
  return downloadTopicActivityOriginal(asset, `${activityId}-${submissionId}`, { activityId, submissionId, assetId }, new URL(request.url).searchParams.get('view') === '1' ? 'inline' : 'attachment')
}
