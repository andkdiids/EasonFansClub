import { NextResponse } from 'next/server'
import { normalizeTopicActivityFormSchema } from '@/lib/topic-activity-form'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await context.params
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, type: 'TOPIC_ACTIVITY', status: 'PUBLISHED' },
    select: { id: true, title: true, startsAt: true, endsAt: true, activityPostId: true, participationMode: true, allowImageAttachments: true, formSchema: true, participationRule: true },
  })
  if (!activity || !['FORM', 'BOTH'].includes(activity.participationMode)) return NextResponse.json({ message: '该活动未开放表单参与' }, { status: 404 })
  const normalized = normalizeTopicActivityFormSchema(activity.formSchema, activity.allowImageAttachments)
  if (!normalized.valid) return NextResponse.json({ message: '活动表单配置无效' }, { status: 500 })
  return NextResponse.json({
    activity: { id: activity.id, title: activity.title, activityPostId: activity.activityPostId, startsAt: activity.startsAt?.toISOString() || null, endsAt: activity.endsAt?.toISOString() || null, participationRule: activity.participationRule },
    participationMode: activity.participationMode,
    allowImageAttachments: activity.allowImageAttachments,
    schema: normalized.value,
  }, { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=30' } })
}
