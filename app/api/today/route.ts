import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { requireUser, sanitizeText } from '@/lib/security'
import { getTodayMonthDay, isTodayEventType, parseTodayDate } from '@/lib/today'
import { parseTodayImageInput } from '@/lib/today-image-url'
import { getTodayEventRecords } from '@/lib/today-events'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { safeNotificationWrite } from '@/lib/notification-transaction'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { month, day } = getTodayMonthDay()
  const events = await getTodayEventRecords()
  // A database/auth service outage must not become canSubmit:false. That
  // false value makes a still-authenticated user look anonymous in the client.
  const user = await getCurrentUser()
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
  const imageInput = parseTodayImageInput(body?.imageUrl, guard.user.id)
  if (!imageInput.valid) return NextResponse.json({ message: '图片无效，请重新选择图片' }, { status: 400 })
  const imageUrl = imageInput.value
  const reference = sanitizeText(body?.reference ?? body?.source, 500)
  if ((await checkBannedWords(`${title}\n${content}`)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }
  if (!date || !isTodayEventType(type) || title.length < 2 || content.length < 5) {
    return NextResponse.json({ message: '请填写有效日期、类型、标题和内容' }, { status: 400 })
  }

  const moderationStatus = isSuperAdmin(guard.user) ? 'APPROVED' as const : 'PENDING' as const
  let administratorIds: string[] = []
  const event = await prisma.$transaction(async (tx) => {
    const createdEvent = await tx.todayEvent.create({
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
        status: moderationStatus,
        reviewedAt: moderationStatus === 'APPROVED' ? new Date() : null,
        reviewedById: moderationStatus === 'APPROVED' ? guard.user.id : null,
        submittedById: guard.user.id,
      },
      select: { id: true, status: true, title: true },
    })
    return createdEvent
  }, { timeout: 15_000, maxWait: 5_000 })

  if (moderationStatus === 'PENDING') {
    await safeNotificationWrite(
      async () => {
        const admins = await prisma.user.findMany({
          where: {
            role: { in: ['ADMIN', 'SUPER_ADMIN'] },
            status: 'ACTIVE',
            isDeleted: false,
            OR: [
              { role: 'SUPER_ADMIN' },
              { AdminPermission: { some: { permissionKey: 'today_manage', enabled: true } } },
            ],
          },
          select: { id: true },
        })
        administratorIds = admins.map((admin) => admin.id)
        if (!admins.length) return
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            recipientId: admin.id,
            type: 'ADMIN' as const,
            title: '有新的今日内容等待审核',
            content: event.title,
            link: '/admin/today',
            key: `today-review:${event.id}`,
          })),
          skipDuplicates: true,
        })
      },
      { operation: 'today-event-review', userId: guard.user.id, notificationType: 'ADMIN' },
    )
  }
  emitRealtimeMany(administratorIds, 'notification')
  return NextResponse.json({
    event,
    message: moderationStatus === 'APPROVED' ? '今日内容已提交并直接发布' : '今日内容已提交，等待管理员审核',
  }, { status: 201 })
}
