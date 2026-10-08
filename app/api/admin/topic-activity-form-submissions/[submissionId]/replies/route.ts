import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { rejectInvalidRequestOrigin, requireRequestAdmin } from '@/lib/security'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { serializeTopicActivityFormSubmission } from '@/lib/topic-activity-form-view'
import { withTopicActivityAdminReplyUnlock } from '@/lib/topic-activity-comment-policy'
import { prisma } from '@/lib/prisma'
import { createHash } from 'node:crypto'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { submissionId } = await context.params
  const body = await request.json().catch(() => null) as { content?: unknown; assetIds?: unknown; requestId?: unknown } | null
  const content = typeof body?.content === 'string' ? body.content.trim().slice(0, 4_000) : ''
  const assetIds = Array.isArray(body?.assetIds) ? body.assetIds.filter((value): value is string => typeof value === 'string') : []
  if (assetIds.length > 9 || new Set(assetIds).size !== assetIds.length) return NextResponse.json({ message: '每次回复最多选择 9 张不同图片' }, { status: 400 })
  if (!content && !assetIds.length) return NextResponse.json({ message: '请填写回复内容或添加图片' }, { status: 400 })
  const requestId = typeof body?.requestId === 'string' ? body.requestId : null
  if (body?.requestId !== undefined && (!requestId || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId))) return NextResponse.json({ message: '回复请求编号无效' }, { status: 400 })
  // Reuse the existing Reply primary key for request idempotency. No new
  // column or unbounded request ledger is needed in the form snapshot.
  const requestReplyId = requestId ? 'tr_' + createHash('sha256').update(JSON.stringify(['topic-form-reply-v61', submissionId, guard.user.id, requestId])).digest('hex') : null
  const submission = await prisma.topicActivityFormSubmission.findUnique({ where: { id: submissionId }, select: { id: true, activityId: true, userId: true, Activity: { select: { title: true } } } })
  if (!submission) return NextResponse.json({ message: '表单提交不存在' }, { status: 404 })

  let replyId = ''
  try {
    await prisma.$transaction(async (tx) => {
      // Keep the same Activity -> submission lock order as lifecycle edits so
      // the durable unlock cannot race a cancellation or schema update.
      await tx.$queryRaw`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${submission.activityId} FOR UPDATE`
      await tx.$queryRaw`SELECT \`id\` FROM \`TopicActivityFormSubmission\` WHERE \`id\` = ${submissionId} FOR UPDATE`
      const lockedSubmission = await tx.topicActivityFormSubmission.findUnique({ where: { id: submissionId }, select: { formSchemaSnapshot: true } })
      if (!lockedSubmission) throw new Error('TOPIC_FORM_SUBMISSION_NOT_FOUND')
      if (requestReplyId) {
        const previous = await tx.topicActivitySubmissionReply.findUnique({
          where: { id: requestReplyId },
          select: { id: true, submissionId: true, senderUserId: true, content: true, ImageAssets: { select: { id: true } } },
        })
        if (previous) {
          if (previous.submissionId !== submissionId || previous.senderUserId !== guard.user!.id || (previous.content || '') !== content
            || JSON.stringify(previous.ImageAssets.map((asset) => asset.id).sort()) !== JSON.stringify([...assetIds].sort())) throw new Error('TOPIC_REPLY_REQUEST_CONFLICT')
          replyId = previous.id
          return
        }
      }
      const assets = assetIds.length ? await tx.topicActivityImageAsset.findMany({
        where: { id: { in: assetIds }, activityId: submission.activityId, uploadedByUserId: guard.user!.id, purpose: 'ADMIN_REPLY', formSubmissionId: null, replyId: null },
        select: { id: true },
      }) : []
      if (assets.length !== assetIds.length) throw new Error('TOPIC_REPLY_ASSET_INVALID')
      const reply = await tx.topicActivitySubmissionReply.create({ data: { ...(requestReplyId ? { id: requestReplyId } : {}), submissionId, senderUserId: guard.user!.id, senderRole: 'ADMIN', content: content || null }, select: { id: true } })
      replyId = reply.id
      if (assets.length) {
        const linked = await tx.topicActivityImageAsset.updateMany({ where: { id: { in: assets.map((asset) => asset.id) }, uploadedByUserId: guard.user!.id, purpose: 'ADMIN_REPLY', activityId: submission.activityId, formSubmissionId: null, replyId: null }, data: { replyId: reply.id } })
        if (linked.count !== assets.length) throw new Error('TOPIC_REPLY_ASSET_INVALID')
      }
      // The marker lives in the immutable form snapshot. It survives reply
      // deletion, so a user who was once unlocked is never re-locked.
      await tx.topicActivityFormSubmission.update({
        where: { id: submissionId },
        data: {
          formSchemaSnapshot: withTopicActivityAdminReplyUnlock(lockedSubmission.formSchemaSnapshot, {
            unlocked: true,
            unlockedAt: new Date().toISOString(),
            replyId: reply.id,
            senderUserId: guard.user!.id,
          }) as Prisma.InputJsonValue,
        },
      })
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof Error && error.message === 'TOPIC_REPLY_REQUEST_CONFLICT') return NextResponse.json({ message: '此回复请求已用于其他内容，请确认后重新发送', code: 'REPLY_REQUEST_CONFLICT' }, { status: 409 })
    if (error instanceof Error && error.message === 'TOPIC_REPLY_ASSET_INVALID') return NextResponse.json({ message: '图片附件无效或已使用，请重新上传' }, { status: 403 })
    console.error('[topic-activity-form.reply.failed]', { submissionId, adminId: guard.user.id })
    return NextResponse.json({ message: '回复发送失败，请稍后重试' }, { status: 500 })
  }

  await safeNotificationWrite(() => createManyNotifications({
    data: [{
      recipientId: submission.userId,
      actorId: null,
      type: 'ACTIVITY',
      title: '话题活动有新回复',
      content: `你在「${submission.Activity.title}」提交的表单收到管理员回复。${assetIds.length ? '管理员已上传新的图片回复。' : ''}`,
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
