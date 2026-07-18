import { NextResponse } from 'next/server'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  if (typeof body?.checkinMoodEnabled !== 'boolean') return NextResponse.json({ message: '签到偏好参数无效' }, { status: 400 })

  const user = await prisma.user.update({
    where: { id: guard.user.id },
    data: { checkinMoodEnabled: body.checkinMoodEnabled },
    select: { checkinMoodEnabled: true },
  })
  invalidateCurrentUserCache(guard.user.id)
  return NextResponse.json({ preferences: user, message: '个性化设置已保存' })
}
