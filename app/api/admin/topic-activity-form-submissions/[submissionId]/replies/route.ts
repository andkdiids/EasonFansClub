import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireRequestAdmin } from '@/lib/security'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { serializeTopicActivityFormSubmission } from '@/lib/topic-activity-form-view'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { submissionId } = await context.params
  const body = await request.json().catch(() => null) as { content?: unknown; assetIds?: unknown } | null
  const content = typeof body?.content === 'string' ? body.content.trim().slice(0, 4_000) : ''
  const assetIds = Array.isArray(body?.assetIds) ? body.assetIds.filter((value): value is string => typeof value === 'string') : []
  if (assetIds.length > 9 || new Set(assetIds).size !== assetIds.length) return NextResponse.json({ message: '每次回复最多选择 9 张不同图片' }, { status: 400 })
  if (!content && !assetIds.length) return NextResponse.json({ message: '请填写回复内容或添加图片' }, { status: 400 })
  const submission = await prisma.topicActivityFormSubmission.findUnique({ where: { id: submissionId }, select: { id: true, activityId: true, userId: true } })
  if (!submission) return NextResponse.json({ message: '表单提交不存在' }, { status: 404 })

  let replyId = ''
  try {
    await prisma.$transaction(async (tx) => {
      const assets = assetIds.length ? await tx.topicActivityImageAsset.findMany({
        where: { id: { in: assetIds }, activityId: submission.activityId, uploadedByUserId: guard.user!.id, purpose: 'ADMIN_REPLY', formSubmissionId: null, replyId: null },
        select: { id: true },
      }) : []
      if (assets.length !== assetIds.length) throw new Error('TOPIC_REPLY_ASSET_INVALID')
      const reply = await tx.topicActivitySubmissionReply.create({ data: { submissionId, senderUserId: guard.user!.id, senderRole: 'ADMIN', content: content || null }, select: { id: true } })
      replyId = reply.id
      if (assets.length) {
        const linked = await tx.topicActivityImageAsset.updateMany({ where: { id: { in: assets.map((asset) => asset.id) }, uploadedByUserId: guard.user!.id, purpose: 'ADMIN_REPLY', activityId: submission.activityId, formSubmissionId: null, replyId: null }, data: { replyId: reply.id } })
        if (linked.count !== assets.length) throw new Error('TOPIC_REPLY_ASSET_INVALID')
      }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof Error && error.message === 'TOPIC_REPLY_ASSET_INVALID') return NextResponse.json({ message: '图片附件无效或已使用，请重新上传' }, { status: 403 })
    console.error('[topic-activity-form.reply.failed]', { submissionId, adminId: guard.user.id })
    return NextResponse.json({ message: '回复发送失败，请稍后重试' }, { status: 500 })
  }

  await safeNotificationWrite(() => createManyNotifications({
    data: [{
      recipientId: submission.userId,
      actorId: guard.user!.id,
      type: 'ACTIVITY',
      title: '你参与的话题活动收到了一条管理员回复',
      content: '你参与的话题活动收到了一条管理员回复',
      link: `/activities/${submission.activityId}?submissionId=${encodeURIComponent(submission.id)}`,
      key: `topic-activity-form-reply:${replyId}`,
    }], skipDuplicates: true,
  }), { operation: 'topic-activity-form-reply-notification', userId: submission.userId, notificationType: 'ACTIVITY' })
  const fresh = await prisma.topicActivityFormSubmission.findUnique({
    where: { id: submissionId },
    include: { ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } }, Replies: { where: { id: replyId }, include: { Sender: { select: { id: true, nickname: true } }, ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } } } } },
  })
  return NextResponse.json({ reply: fresh ? (await serializeTopicActivityFormSubmission(fresh)).replies[0] : null }, { status: 201, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
