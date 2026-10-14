import { NextResponse } from 'next/server'
import { reconcileTopicActivityCommentSubmissions } from '@/lib/topic-activity'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,80}$/

export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '话题活动不存在' }, { status: 404 })

  try {
    const result = await reconcileTopicActivityCommentSubmissions(activityId)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TOPIC_RECONCILE_FAILED'
    const status = code === 'TOPIC_ACTIVITY_NOT_FOUND' ? 404 : code === 'TOPIC_ACTIVITY_CANCELLED' || code === 'TOPIC_ACTIVITY_POST_UNAVAILABLE' || code === 'TOPIC_ACTIVITY_WINDOW_UNAVAILABLE' ? 409 : 500
    if (status === 500) console.error('[topic-activity.reconcile.failed]', { activityId, adminId: guard.user.id, code })
    return NextResponse.json({ code, message: status === 500 ? '修复历史参与记录失败，请稍后重试' : code === 'TOPIC_ACTIVITY_CANCELLED' ? '已取消的活动不能补建参与记录' : code === 'TOPIC_ACTIVITY_WINDOW_UNAVAILABLE' ? '活动时间范围不完整，不能安全识别历史参与评论' : '活动主帖不可用' }, { status })
  }
}
