import { requireRequestUser, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { checkBannedWords, BANNED_WORD_MESSAGE } from '@/lib/content-moderation'
import { getTopicActivityV2View, submitTopicActivityV2Task } from '@/lib/topic-activity-v2'
import { prisma } from '@/lib/prisma'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { readTopicV2Body, topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }
export async function GET(request: Request, context: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  const admin = await hasAdminPermission(guard.user, 'activity_manage')
  try {
    await getTopicActivityV2View(activityId, guard.user.id, admin)
    const all = admin && new URL(request.url).searchParams.get('scope') === 'all'
    const submissions = await prisma.topicActivitySubmission.findMany({
      where: { activityId, rewardEntryId: { not: null }, ...(all ? {} : { userId: guard.user.id }) },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, userId: true, commentId: true, rewardEntryId: true, rewardSnapshot: true, status: true, submittedAt: true, reviewedAt: true, rejectReason: true,
        User: { select: { nickname: true, uid: true } }, TaskImageAssets: { select: { id: true, width: true, height: true, size: true } } },
    })
    return topicV2Json({ submissions: submissions.map((item) => ({ ...item, assets: item.TaskImageAssets.map((asset) => ({ assetId: asset.id, width: asset.width, height: asset.height, size: asset.size,
      previewAccessUrl: `/api/activities/${activityId}/assets/${asset.id}/preview`, originalDownloadUrl: `/api/activities/${activityId}/v2/submissions/${item.id}/assets/${asset.id}/original` })) })) })
  } catch (error) { return topicV2ErrorResponse(error) }
}

export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, { endpoint: '/api/activities/v2/tasks', ip: { limit: 80, windowSeconds: 3600 }, user: { limit: 20, windowSeconds: 3600 } }, '提交过于频繁，请稍后重试')
  if (limited) return limited
  const { activityId } = await context.params
  const body = await readTopicV2Body(request)
  if (!topicV2IdPattern.test(activityId) || !body || typeof body.rewardEntryId !== 'string' || !topicV2IdPattern.test(body.rewardEntryId)
    || !Array.isArray(body.assetIds) || body.assetIds.length > 20 || body.assetIds.some((id) => typeof id !== 'string' || !topicV2IdPattern.test(id))
    || (body.remark !== undefined && typeof body.remark !== 'string') || (typeof body.remark === 'string' && body.remark.length > 2000)) {
    return topicV2Json({ code: 'INVALID_TASK', message: '任务提交格式无效' }, 400)
  }
  const remark = typeof body.remark === 'string' ? body.remark.trim() : ''
  if ((await checkBannedWords(remark)).blocked) return topicV2Json({ code: 'CONTENT_CONTAINS_BANNED_WORD', message: BANNED_WORD_MESSAGE }, 400)
  try {
    const result = await submitTopicActivityV2Task({ activityId, userId: guard.user.id, rewardEntryId: body.rewardEntryId, assetIds: body.assetIds as string[], remark })
    if (result.postAuthorId !== guard.user.id) await safeNotificationWrite(() => createManyNotifications({ data: [{
      recipientId: result.postAuthorId, actorId: guard.user.id, type: 'REPLY', title: '活动主帖有新任务提交',
      content: '一条平台任务已提交，等待审核', link: `/activities/${activityId}?focus=${result.commentId}`, key: `topic-v2-task:${result.commentId}`,
    }], skipDuplicates: true }), { operation: 'topic-v2-task-notification', userId: guard.user.id, notificationType: 'REPLY' })
    return topicV2Json(result, 201)
  }
  catch (error) { return topicV2ErrorResponse(error) }
}
