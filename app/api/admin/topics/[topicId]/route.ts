import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { normalizeTopicName } from '@/lib/post-topics'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Params = { params: Promise<{ topicId: string }> }

function parseOptionalDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const { topicId } = await params
  const existing = await prisma.topic.findUnique({ where: { id: topicId }, select: { id: true } })
  if (!existing) return NextResponse.json({ message: '话题不存在' }, { status: 404 })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const name = normalizeTopicName(body?.name)
  if (!name) return NextResponse.json({ message: '话题名称只能包含中文、英文、数字或下划线' }, { status: 400 })
  const normalizedName = name.toLocaleLowerCase('en-US')
  const duplicate = await prisma.topic.findFirst({ where: { normalizedName, id: { not: topicId } }, select: { id: true } })
  if (duplicate) return NextResponse.json({ message: '该话题已存在，请直接编辑已有话题' }, { status: 409 })
  const activityValue = body?.activityId
  let activityId: string | null | undefined = null
  if (activityValue !== null && activityValue !== undefined && activityValue !== '') {
    if (typeof activityValue !== 'string') return NextResponse.json({ message: '关联活动无效' }, { status: 400 })
    const activity = await prisma.activity.findUnique({ where: { id: activityValue }, select: { id: true } })
    if (!activity) return NextResponse.json({ message: '关联活动不存在' }, { status: 400 })
    activityId = activity.id
  }
  const startAt = parseOptionalDate(body?.startAt)
  const endAt = parseOptionalDate(body?.endAt)
  if (startAt === undefined || endAt === undefined) return NextResponse.json({ message: '开始/结束时间格式无效' }, { status: 400 })
  if (startAt && endAt && endAt <= startAt) return NextResponse.json({ message: '结束时间必须晚于开始时间' }, { status: 400 })
  const topic = await prisma.topic.update({
    where: { id: topicId },
    data: {
      name,
      normalizedName,
      description: sanitizeText(body?.description, 1000) || null,
      coverImage: sanitizeText(body?.coverImage, 1000) || null,
      isOfficial: Boolean(body?.isOfficial),
      activityId,
      startAt,
      endAt,
    },
    include: { Activity: { select: { id: true, title: true } } },
  })
  revalidatePath(`/topics/${topicId}`)
  revalidatePath('/forum')
  return NextResponse.json({ topic })
}
