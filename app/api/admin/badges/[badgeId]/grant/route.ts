import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { grantBadge } from '@/lib/badge-service'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { formatUid } from '@/lib/uid'
import { prisma } from '@/lib/prisma'

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
    const result = await grantBadge({
      userId: target.id,
      badgeId,
      actorId: guard.user.id,
      sourceType: sanitizeText(body.sourceType, 32) || 'MANUAL',
      sourceId: sanitizeText(body.sourceId, 191) || null,
      grantReason: sanitizeText(body.grantReason, 500) || null,
    })
    if (!result.created) return NextResponse.json({ ...result, message: '该用户已经拥有此勋章' }, { status: 409 })
    invalidateCurrentUserCache(target.id)
    revalidatePath(`/user/${formatUid(target.uid)}`)
    revalidatePath(`/user/${formatUid(target.uid)}/badges`)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '发放失败' }, { status: 400 })
  }
}
