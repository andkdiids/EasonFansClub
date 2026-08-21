import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { revokeBadge, BadgeServiceError } from '@/lib/badge-service'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

async function resolveTarget(body: Record<string, unknown>) {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const uidRaw = typeof body.uid === 'number' ? body.uid : Number.parseInt(String(body.uid || ''), 10)
  return prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      ...(userId ? { id: userId } : Number.isInteger(uidRaw) && uidRaw > 0 ? { uid: uidRaw } : { id: '__missing__' }),
    },
    select: { id: true, uid: true },
  })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求无效' }, { status: 400 })
  const target = await resolveTarget(body as Record<string, unknown>)
  if (!target) return NextResponse.json({ message: '目标用户不存在或已停用' }, { status: 404 })

  try {
    const result = await revokeBadge({ userId: target.id, badgeId, actorId: guard.user.id, reason: sanitizeText(body.reason, 500) || null })
    invalidateCurrentUserCache(target.id)
    revalidatePath(`/user/${formatUid(target.uid)}`)
    revalidatePath(`/user/${formatUid(target.uid)}/badges`)
    return NextResponse.json(result)
  } catch (error) {
    const status = error instanceof BadgeServiceError && error.code === 'NOT_FOUND' ? 404 : 400
    return NextResponse.json({ message: error instanceof Error ? error.message : '收回失败' }, { status })
  }
}
