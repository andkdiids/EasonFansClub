import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getTodayEventDateKey, isTodayEventType, parseTodayDate } from '@/lib/today'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { parseTodayImageInput } from '@/lib/today-image-url'

export const dynamic = 'force-dynamic'

const eventSelect = {
  id: true,
  date: true,
  month: true,
  day: true,
  type: true,
  title: true,
  content: true,
  imageUrl: true,
  source: true,
  reference: true,
  status: true,
  rejectionReason: true,
  reviewedAt: true,
  createdAt: true,
  submittedById: true,
  SubmittedBy: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
} as const

type TodayEventRow = Prisma.TodayEventGetPayload<{ select: typeof eventSelect }>

function serializeEvent(event: TodayEventRow) {
  const { SubmittedBy, ...data } = event
  return {
    ...data,
    date: getTodayEventDateKey(event.date, event.month, event.day),
    imageUrl: publicImageUrl(event.imageUrl),
    submittedBy: SubmittedBy ? { uid: SubmittedBy.uid, name: SubmittedBy.nickname || 'E院用户' } : null,
  }
}

export async function GET(request: Request) {
  const guard = await requireAdmin('today_manage')
  if (!guard.user) return guard.response

  const status = new URL(request.url).searchParams.get('status')
  const events = await prisma.todayEvent.findMany({
    where: status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : undefined,
    orderBy: [{ status: 'asc' }, { date: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: eventSelect,
  })
  return NextResponse.json({ events: events.map(serializeEvent) })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('today_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const date = parseTodayDate(body?.date)
  const type = body?.type
  const title = sanitizeText(body?.title, 160)
  const content = sanitizeText(body?.content, 10_000)
  const imageInput = parseTodayImageInput(body?.imageUrl, guard.user.id)
  if (!imageInput.valid) return NextResponse.json({ message: '图片无效，请重新选择图片' }, { status: 400 })
  const imageUrl = imageInput.value
  const reference = sanitizeText(body?.reference ?? body?.source, 500)
  const status = body?.status === 'PENDING' || body?.status === 'REJECTED' ? body.status : 'APPROVED'
  if ((await checkBannedWords(`${title}\n${content}`)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }
  if (!date || !isTodayEventType(type) || title.length < 2 || content.length < 5) {
    return NextResponse.json({ message: '请填写有效日期、类型、标题和内容' }, { status: 400 })
  }

  const event = await prisma.todayEvent.create({
    data: {
      date: date.date,
      month: date.month,
      day: date.day,
      type,
      title,
      content,
      imageUrl,
      source: 'ADMIN',
      reference: reference || null,
      status,
      reviewedAt: status === 'PENDING' ? null : new Date(),
      reviewedById: status === 'PENDING' ? null : guard.user.id,
    },
    select: eventSelect,
  })
  revalidatePath('/today')
  return NextResponse.json({ event: serializeEvent(event) }, { status: 201 })
}
