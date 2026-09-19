import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { normalizeTopicName } from '@/lib/post-topics'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

function parseOptionalDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

async function resolveActivityId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const activity = await prisma.activity.findUnique({ where: { id: value }, select: { id: true } })
  return activity?.id || undefined
}

export async function GET() {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const topics = await prisma.topic.findMany({
    orderBy: [{ isOfficial: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    take: 500,
    include: {
      Activity: { select: { id: true, title: true } },
      _count: { select: { PostTopic: true } },
    },
  })
  return NextResponse.json({ topics })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const name = normalizeTopicName(body?.name)
  if (!name) return NextResponse.json({ message: '话题名称只能包含中文、英文、数字或下划线' }, { status: 400 })
  const activityId = await resolveActivityId(body?.activityId)
  if (activityId === undefined) return NextResponse.json({ message: '关联活动不存在' }, { status: 400 })
  const startAt = parseOptionalDate(body?.startAt)
  const endAt = parseOptionalDate(body?.endAt)
  if (startAt === undefined || endAt === undefined) return NextResponse.json({ message: '开始/结束时间格式无效' }, { status: 400 })
  if (startAt && endAt && endAt <= startAt) return NextResponse.json({ message: '结束时间必须晚于开始时间' }, { status: 400 })
  const normalizedName = name.toLocaleLowerCase('en-US')
  const topic = await prisma.topic.upsert({
    where: { normalizedName },
    update: {
      name,
      description: sanitizeText(body?.description, 1000) || null,
      coverImage: sanitizeText(body?.coverImage, 1000) || null,
      isOfficial: Boolean(body?.isOfficial),
      activityId,
      startAt,
      endAt,
    },
    create: {
      name,
      normalizedName,
      description: sanitizeText(body?.description, 1000) || null,
      coverImage: sanitizeText(body?.coverImage, 1000) || null,
      isOfficial: Boolean(body?.isOfficial),
      activityId,
      startAt,
      endAt,
      createdById: guard.user.id,
    },
    include: { Activity: { select: { id: true, title: true } } },
  })
  revalidatePath('/topics/[topicId]', 'page')
  revalidatePath('/forum')
  return NextResponse.json({ topic }, { status: 201 })
}
