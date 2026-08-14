import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { emitRealtime } from '@/lib/realtime'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { requireAdmin } from '@/lib/security'
import {
  grantUserReward,
  listUserRewards,
  serializeRewardUser,
  USER_REWARD_PAGE_SIZE,
  USER_REWARD_PERMISSION,
  UserRewardError,
} from '@/lib/user-rewards'

export const dynamic = 'force-dynamic'

const privateNoStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function rewardErrorResponse(error: unknown) {
  if (error instanceof UserRewardError) {
    const status = error.code === 'USER_NOT_FOUND' ? 404 : error.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 400
    return NextResponse.json({ message: error.message, code: error.code }, { status, headers: privateNoStoreHeaders })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ message: '奖励请求已存在，请刷新后重试', code: 'DUPLICATE_REWARD_REQUEST' }, { status: 409, headers: privateNoStoreHeaders })
  }
  throw error
}

export async function GET(request: Request) {
  const guard = await requireAdmin(USER_REWARD_PERMISSION)
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const result = await listUserRewards({
    q: searchParams.get('q') || undefined,
    operatorId: searchParams.get('operatorId') || undefined,
    from: searchParams.get('from') || undefined,
    to: searchParams.get('to') || undefined,
    page: Number(searchParams.get('page') || 1),
    pageSize: Math.min(Number(searchParams.get('pageSize') || USER_REWARD_PAGE_SIZE), 50),
  })
  return NextResponse.json(result, { headers: privateNoStoreHeaders })
}

export async function POST(request: Request) {
  const guard = await requireAdmin(USER_REWARD_PERMISSION)
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  try {
    const result = await grantUserReward({
      transactionId: body?.transactionId,
      userId: body?.userId,
      operatorId: guard.user.id,
      experienceAmount: body?.experienceAmount,
      registrationFeeAmount: body?.registrationFeeAmount,
      reason: body?.reason,
    })

    invalidateCurrentUserCache(result.user.id)
    emitRealtime(result.user.id, 'notification')
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      message: '奖励发放成功',
      reward: {
        rewardId: result.reward.id,
        transactionId: result.reward.transactionId,
        experienceAmount: result.reward.experienceAmount,
        registrationFeeAmount: result.reward.registrationFeeAmount,
        reason: result.reward.reason,
        createdAt: result.reward.createdAt.toISOString(),
      },
      user: serializeRewardUser(result.user),
    }, { headers: privateNoStoreHeaders })
  } catch (error) {
    return rewardErrorResponse(error)
  }
}
