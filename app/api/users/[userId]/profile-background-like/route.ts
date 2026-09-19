import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getProfileBackgroundLikeSummary,
  ProfileBackgroundLikeError,
  setProfileBackgroundLike,
} from '@/lib/profile-background-likes'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ userId: string }> }

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function validUserId(value: string) {
  return /^[a-zA-Z0-9_-]{1,191}$/.test(value)
}

async function findProfileOwner(userId: string) {
  if (!validUserId(userId)) return null
  return prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true },
  })
}

function errorResponse(error: unknown) {
  if (error instanceof ProfileBackgroundLikeError) {
    const status = error.code === 'PROFILE_OWNER_NOT_FOUND'
      ? 404
      : error.code === 'PROFILE_BACKGROUND_ACCESS_DENIED'
        ? 403
      : error.code === 'PROFILE_BACKGROUND_DAILY_LIMIT_REACHED'
        ? 429
        : error.code === 'PROFILE_BACKGROUND_REQUIRED'
          ? 409
          : 400
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status, headers: noStoreHeaders })
  }
  console.error('[profile-background-like]', { errorName: error instanceof Error ? error.name : 'unknown' })
  return NextResponse.json(
    { ok: false, code: 'PROFILE_BACKGROUND_LIKE_UNAVAILABLE', message: '主页背景点赞暂时失败，请稍后重试' },
    { status: 503, headers: noStoreHeaders },
  )
}

export async function GET(_request: Request, context: RouteContext) {
  const { userId } = await context.params
  const owner = await findProfileOwner(userId)
  if (!owner) return NextResponse.json({ ok: false, message: '用户不存在或不可用' }, { status: 404, headers: noStoreHeaders })
  const viewer = await getCurrentUser()
  const summary = await getProfileBackgroundLikeSummary(owner.id, viewer?.id)
  return NextResponse.json({ ok: true, ...summary }, { headers: noStoreHeaders })
}

async function mutate(request: Request, context: RouteContext, liked: boolean) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: `/api/users/[userId]/profile-background-like:${liked ? 'POST' : 'DELETE'}`,
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  })
  if (limited) return limited

  const { userId } = await context.params
  if (!validUserId(userId)) {
    return NextResponse.json({ ok: false, message: '用户不存在或不可用' }, { status: 404, headers: noStoreHeaders })
  }

  try {
    const result = await setProfileBackgroundLike({ likerId: guard.user.id, profileOwnerId: userId, liked })
    return NextResponse.json(result, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  return mutate(request, context, true)
}

export async function DELETE(request: Request, context: RouteContext) {
  return mutate(request, context, false)
}
