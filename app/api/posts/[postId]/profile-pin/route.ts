import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }
type ProfilePinAction = 'pin' | 'unpin'

function logProfilePinError(error: unknown, postId: string, userId: string, action: ProfilePinAction) {
  const knownError = error instanceof Prisma.PrismaClientKnownRequestError
  console.error('[posts.profile-pin]', {
    postId,
    userId,
    action,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    prismaCode: knownError ? error.code : undefined,
    message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
  })
}

async function updateProfilePin(postId: string, userId: string, action: ProfilePinAction) {
  return prisma.$transaction(async (tx) => {
    // Lock the author row so concurrent pin requests for two different posts
    // still observe one serialized two-post limit.
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`

    const post = await tx.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, isDeleted: true, profilePinnedAt: true },
    })
    if (!post || post.isDeleted) return { kind: 'not-found' as const }
    if (post.authorId !== userId) return { kind: 'forbidden' as const }

    const shouldPin = action === 'pin'
    const isPinned = Boolean(post.profilePinnedAt)
    if (isPinned === shouldPin) {
      return { kind: 'ok' as const, postId: post.id, profilePinnedAt: post.profilePinnedAt }
    }

    if (shouldPin) {
      const pinnedCount = await tx.post.count({
        where: { authorId: userId, isDeleted: false, profilePinnedAt: { not: null } },
      })
      if (pinnedCount >= 2) return { kind: 'limit' as const }
    }

    const updated = await tx.post.update({
      where: { id: postId },
      data: { profilePinnedAt: shouldPin ? new Date() : null },
      select: { id: true, profilePinnedAt: true },
    })
    return { kind: 'ok' as const, postId: updated.id, profilePinnedAt: updated.profilePinnedAt }
  })
}

async function handleProfilePin(context: RouteContext, action: ProfilePinAction) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await context.params
  try {
    const result = await updateProfilePin(postId, guard.user.id, action)
    if (result.kind === 'not-found') return NextResponse.json({ message: '帖子不存在或已经被删除' }, { status: 404 })
    if (result.kind === 'forbidden') return NextResponse.json({ message: '只能置顶自己发布的帖子' }, { status: 403 })
    if (result.kind === 'limit') {
      return NextResponse.json({
        code: 'PROFILE_PIN_LIMIT',
        message: '个人主页最多置顶 2 篇帖子，请先取消一篇置顶。',
      }, { status: 409 })
    }

    return NextResponse.json({
      ok: true,
      postId: result.postId,
      isProfilePinned: Boolean(result.profilePinnedAt),
      profilePinnedAt: result.profilePinnedAt?.toISOString() || null,
      message: action === 'pin' ? '已置顶到个人主页' : '已取消置顶',
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    logProfilePinError(error, postId, guard.user.id, action)
    return NextResponse.json({ message: '个人主页置顶暂时不可用，请稍后重试' }, { status: 503 })
  }
}

export async function POST(_request: Request, context: RouteContext) {
  return handleProfilePin(context, 'pin')
}

export async function DELETE(_request: Request, context: RouteContext) {
  return handleProfilePin(context, 'unpin')
}
