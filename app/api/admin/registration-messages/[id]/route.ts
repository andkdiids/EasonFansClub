import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { isValidDailyMessageId, syncDailyMessageDeletionEffects } from '@/lib/daily-message-deletion'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('daily_message_manage')
  if (!guard.user) return guard.response

  const { id } = await context.params
  const body = await request.json().catch(() => null)

  const data: Record<string, unknown> = {}
  if (typeof body?.moderationStatus === 'string' && (VALID_STATUS as readonly string[]).includes(body.moderationStatus)) {
    data.moderationStatus = body.moderationStatus
  }
  if (typeof body?.sort === 'number') data.sort = body.sort
  if (typeof body?.isAdminMessage === 'boolean') data.isAdminMessage = body.isAdminMessage

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: '没有需要更新的字段' }, { status: 400 })
  }

  try {
    const updated = await prisma.dailyMessage.update({
      where: { id },
      data,
      select: {
        id: true,
        content: true,
        moderationStatus: true,
        isAdminMessage: true,
        sort: true,
        isDeleted: true,
        createdAt: true,
        User: { select: { id: true, nickname: true, uid: true } },
      },
    })
    revalidatePath('/admin/registration-messages')
    return NextResponse.json({ messageRow: updated })
  } catch (error) {
    console.error('[admin:registration-messages:update]', error)
    return NextResponse.json({ message: '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin('daily_message_manage')
  if (!guard.user) return guard.response

  const { id } = await context.params
  if (!isValidDailyMessageId(id)) {
    return NextResponse.json({ message: '留言 ID 格式不正确' }, { status: 400 })
  }

  try {
    const existing = await prisma.dailyMessage.findUnique({
      where: { id },
      select: { id: true, userId: true, checkInId: true, content: true, isDeleted: true, deletedAt: true },
    })
    if (!existing) return NextResponse.json({ message: '留言不存在' }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.dailyMessage.updateMany({
        where: { id },
        data: { isDeleted: true, deletedAt: existing.deletedAt || new Date() },
      })
      await syncDailyMessageDeletionEffects(tx, existing, true)
    })

    invalidateCheckInMessagesCache()
    invalidateHomeDataCache()
    revalidatePath('/admin/registration-messages')
    return NextResponse.json({ message: '已删除' })
  } catch (error) {
    console.error('[admin:registration-messages:delete]', error)
    return NextResponse.json({ message: '删除失败' }, { status: 500 })
  }
}
