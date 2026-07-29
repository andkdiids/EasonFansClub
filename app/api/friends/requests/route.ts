import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createFriendRequest } from '@/lib/friends'
import { sanitizeText } from '@/lib/security'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const targetUid = Number(body?.uid ?? body?.receiverUid)
  if (!Number.isInteger(targetUid)) return NextResponse.json({ message: '请输入正确 UID' }, { status: 400 })

  const result = await createFriendRequest(user, targetUid, sanitizeText(body?.message, 120) || null)
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
