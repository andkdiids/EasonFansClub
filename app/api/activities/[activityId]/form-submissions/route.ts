import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { requireRequestUser, enforceApiRateLimit } from '@/lib/security'
import { normalizeTopicActivityFormSchema, validateTopicActivityFormAnswers } from '@/lib/topic-activity-form'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  const limited = await enforceApiRateLimit(request, guard.user.id, { endpoint: '/api/activities/form-submissions', ip: { limit: 30, windowSeconds: 3600 }, user: { limit: 12, windowSeconds: 3600 } }, '提交过于频繁，请稍后再试')
  if (limited) return limited
  const body = await request.json().catch(() => null) as { answers?: unknown } | null
  if (!body || !body.answers || typeof body.answers !== 'object') return NextResponse.json({ message: '表单内容无效' }, { status: 400 })

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, type: true, status: true, startsAt: true, endsAt: true, participationMode: true, allowImageAttachments: true, formSchema: true } })
    if (!activity || activity.type !== 'TOPIC_ACTIVITY') return { error: 'NOT_FOUND' as const }
    if (activity.status !== 'PUBLISHED' || (activity.startsAt && activity.startsAt > new Date()) || (activity.endsAt && activity.endsAt < new Date())) return { error: 'CLOSED' as const }
    if (!['FORM', 'BOTH'].includes(activity.participationMode)) return { error: 'MODE_DISABLED' as const }
    const normalized = normalizeTopicActivityFormSchema(activity.formSchema, activity.allowImageAttachments)
    if (!normalized.valid) return { error: 'INVALID_SCHEMA' as const }
    const validated = validateTopicActivityFormAnswers(normalized.value, body.answers)
    if (!validated.valid) return { error: validated.message }

    const assets = validated.value.assetIds.length ? await tx.topicActivityImageAsset.findMany({
      where: { id: { in: validated.value.assetIds }, activityId, uploadedByUserId: guard.user.id, purpose: 'FORM_ANSWER', formSubmissionId: null, replyId: null },
      select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true },
    }) : []
    if (assets.length !== validated.value.assetIds.length) return { error: 'INVALID_ASSET' as const }
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
    const answers = validated.value.answers.map((answer) => answer.type === 'IMAGE'
      ? { ...answer, value: ((answer.value as { assetIds: string[] }).assetIds).flatMap((id) => {
          const asset = assetMap.get(id)
          return asset ? [{ assetId: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType, width: asset.width, height: asset.height, size: asset.size }] : []
        }) }
      : answer)
    const submission = await tx.topicActivityFormSubmission.create({
      data: {
        activityId,
        userId: guard.user.id,
        formSchemaSnapshot: normalized.value as unknown as Prisma.InputJsonValue,
        answersSnapshot: answers as unknown as Prisma.InputJsonValue,
        submittedAt: new Date(),
      },
      select: { id: true, activityId: true, status: true, submittedAt: true },
    })
    if (assets.length) {
      const linked = await tx.topicActivityImageAsset.updateMany({ where: { id: { in: assets.map((asset) => asset.id) }, uploadedByUserId: guard.user.id, activityId, formSubmissionId: null, replyId: null }, data: { formSubmissionId: submission.id } })
      if (linked.count !== assets.length) throw new Error('TOPIC_FORM_ASSET_ALREADY_USED')
    }
    return { submission }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  if ('error' in result) {
    const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'CLOSED' || result.error === 'MODE_DISABLED' ? 409 : result.error === 'INVALID_ASSET' ? 403 : 400
    const message = result.error === 'CLOSED' ? '活动当前未开放或已截止' : result.error === 'MODE_DISABLED' ? '该活动暂不开放表单参与' : result.error === 'INVALID_SCHEMA' ? '活动表单暂时不可用' : result.error === 'INVALID_ASSET' ? '请重新选择未使用的图片附件' : result.error === 'NOT_FOUND' ? '话题活动不存在' : result.error
    return NextResponse.json({ message }, { status })
  }
  return NextResponse.json({ success: true, submission: result.submission }, { status: 201, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
