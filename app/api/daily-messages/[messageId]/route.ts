import { NextResponse } from 'next/server'
import { formatBeijingDate } from '@/lib/checkin'
import { deleteDailyMessageForOwner, isValidDailyMessageId } from '@/lib/daily-message-deletion'
import { DailyMessageEditError, editDailyMessageForOwner } from '@/lib/daily-message-edit'
import { validateCheckInMessage } from '@/lib/checkin-message-validation'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]:PATCH',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  })
  if (limited) return limited

  const { messageId } = await context.params
  if (!isValidDailyMessageId(messageId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_MESSAGE_ID', message: '留言 ID 格式不正确' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const validation = await validateCheckInMessage(body?.message)
  if (!validation.ok) return NextResponse.json(validation, { status: 400 })

  const now = new Date()
  try {
    const result = await prisma.$transaction((tx) => editDailyMessageForOwner(tx, {
      messageId,
      userId: guard.user.id,
      content: validation.message,
      now,
    }))

    invalidateCheckInMessagesCache()
    invalidateHomeDataCache()
    return NextResponse.json({
      ok: true,
      code: 'MESSAGE_EDITED',
      message: '留言已修改',
      dailyMessage: {
        id: result.id,
        content: result.content,
        editedAt: result.editedAt.toISOString(),
        createdAt: result.createdAt.toISOString(),
        date: formatBeijingDate(result.date),
      },
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
  } catch (error) {
    if (error instanceof DailyMessageEditError) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    }
    console.error('[daily-messages:edit]', { userId: guard.user.id, messageId, error })
    return NextResponse.json({ ok: false, code: 'MESSAGE_EDIT_FAILED', message: '留言修改失败，请稍后重试' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(_request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]:DELETE',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  })
  if (limited) return limited

  const { messageId } = await context.params
  if (!isValidDailyMessageId(messageId)) {
    return NextResponse.json({ message: '留言 ID 格式不正确' }, { status: 400 })
  }

  const result = await deleteDailyMessageForOwner(messageId, guard.user.id)
  if (result.status !== 200) {
    return NextResponse.json({ message: result.message }, { status: result.status })
  }

  return NextResponse.json({ ok: true, message: result.message, alreadyDeleted: result.alreadyDeleted }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
  })
}
