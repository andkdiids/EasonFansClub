import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { requireUser, sanitizeText } from '@/lib/security'
import { getTodayMonthDay, isTodayEventType, parseTodayDate } from '@/lib/today'
import { getTodayEventRecords } from '@/lib/today-events'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { month, day } = getTodayMonthDay()
  const events = await getTodayEventRecords()
  const user = await getCurrentUser().catch(() => null)
  return NextResponse.json({
    date: { month, day },
    events,
    canSubmit: Boolean(user),
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const date = parseTodayDate(body?.date)
  const type = body?.type
  const title = sanitizeText(body?.title, 160)
  const content = sanitizeText(body?.content, 10_000)
  const imageUrl = publicImageUrl(sanitizeText(body?.imageUrl, 1000))
  const reference = sanitizeText(body?.reference ?? body?.source, 500)
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
      status: 'PENDING',
      submittedById: guard.user.id,
    },
    select: { id: true, status: true, title: true },
  })
  return NextResponse.json({ event, message: '今日内容已提交，等待管理员审核' }, { status: 201 })
}
