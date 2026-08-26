import { NextResponse } from 'next/server'
import { createFriendRequest } from '@/lib/friends'
import { validateFriendRequestReason } from '@/lib/friend-request-validation'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/friends/requests',
    ip: { limit: 50, windowSeconds: 60 * 60 },
    user: { limit: 10, windowSeconds: 60 * 60 },
  }, '好友申请过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const targetUid = Number(body?.uid ?? body?.receiverUid)
  if (!Number.isInteger(targetUid)) return NextResponse.json({ message: '请输入正确 UID' }, { status: 400 })

  const reason = validateFriendRequestReason(body?.reason ?? body?.message)
  if (!reason.ok) {
    return NextResponse.json({ ok: false, code: reason.code, message: reason.message }, { status: 400 })
  }

  const result = await createFriendRequest(user, targetUid, reason.reason)
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
