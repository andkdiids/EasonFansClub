import { NextResponse } from 'next/server'
import { deleteDailyMessageForOwner, isValidDailyMessageId } from '@/lib/daily-message-deletion'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

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
