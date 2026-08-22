import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getUserBadgeShowcase, updateUserBadgeShowcase } from '@/lib/badge-service'
import { formatUid } from '@/lib/uid'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  return NextResponse.json({ showcase: await getUserBadgeShowcase(guard.user.id, guard.user.id) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'users-me-badge-showcase',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '荣誉橱窗更新过于频繁，请稍后再试')
  if (limited) return limited
  const body = await request.json().catch(() => null) as { badgeIds?: unknown } | null
  if (!Array.isArray(body?.badgeIds) || body.badgeIds.some((value) => typeof value !== 'string')) return NextResponse.json({ message: '荣誉橱窗数据格式无效' }, { status: 400 })
  try {
    const result = await updateUserBadgeShowcase(guard.user.id, body.badgeIds as string[])
    revalidatePath('/profile')
    revalidatePath(`/user/${formatUid(guard.user.uid)}`)
    revalidatePath(`/user/${formatUid(guard.user.uid)}/badges`)
    return NextResponse.json({ ...result, showcase: await getUserBadgeShowcase(guard.user.id, guard.user.id) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '荣誉橱窗更新失败' }, { status: 400 })
  }
}
