import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  if (!(await canAccessAnywhereDoor(guard.user))) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/anywhere-door/[postId]/like:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  })
  if (limited) return limited
  const { postId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ message: '动态不存在' }, { status: 404 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const post = await tx.socialPost.findFirst({ where: { id: postId, status: 'READY' }, select: { id: true } })
      if (!post) return null
      const existing = await tx.socialPostLike.findUnique({ where: { userId_postId: { userId: guard.user.id, postId } }, select: { id: true } })
      if (existing) await tx.socialPostLike.delete({ where: { id: existing.id } })
      else await tx.socialPostLike.create({ data: { userId: guard.user.id, postId } })
      return { liked: !existing, likeCount: await tx.socialPostLike.count({ where: { postId } }) }
    })
    if (!result) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[anywhere-door.like]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '点赞操作暂时失败' }, { status: 503 })
  }
}
