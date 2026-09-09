import { NextResponse } from 'next/server'
import { ActivityNotificationError, getActivityNotificationOverview, sendActivityTargetedNotification } from '@/lib/activity-notification'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  const overview = await getActivityNotificationOverview(activityId)
  if (!overview) return NextResponse.json({ message: '活动不存在' }, { status: 404, headers: privateHeaders })
  return NextResponse.json(overview, { headers: privateHeaders })
}

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  const body = await request.json().catch(() => null)
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  if ('recipientIds' in input || 'sendToAll' in input || 'audience' in input) {
    return NextResponse.json({ code: 'RECIPIENTS_SERVER_RESOLVED', message: '收件人由服务端根据活动报名记录确定' }, { status: 400, headers: privateHeaders })
  }

  try {
    const result = await sendActivityTargetedNotification({
      activityId,
      operatorId: guard.user.id,
      title: input.title,
      content: input.content,
      imageUrl: input.imageUrl,
      idempotencyKey: input.idempotencyKey,
    })
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      batch: result.batch,
      message: result.duplicate
        ? `该发送请求已经完成：已发送给 ${result.batch.sentCount} 名报名用户`
        : `已发送给 ${result.batch.sentCount} 名报名用户${result.batch.skippedCount ? `，跳过 ${result.batch.skippedCount} 名` : ''}`,
    }, { status: result.duplicate ? 200 : 201, headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityNotificationError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activity-targeted-notification.send]', {
      activityId,
      operatorId: guard.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ code: 'ACTIVITY_NOTIFICATION_FAILED', message: '活动通知发送失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
