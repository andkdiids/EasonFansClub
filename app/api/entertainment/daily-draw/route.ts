import { NextResponse } from 'next/server'
import { getCurrentUser, isAuthServiceUnavailableError } from '@/lib/auth'
import { getEntertainmentDailyDrawStatus, issueEntertainmentDailyDraw } from '@/lib/entertainment'
import { rejectInvalidRequestOrigin, unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

function unauthorized() {
  return unauthenticatedResponse('请先登录后再抽取今日处方', undefined, { data: null, error: '请先登录后再抽取今日处方' })
}

function serviceError(error: unknown, operation: string) {
  console.error(`[entertainment.dailyDraw.${operation}]`, error)
  const unavailable = isAuthServiceUnavailableError(error)
  return NextResponse.json(
    {
      ok: false,
      data: null,
      error: unavailable ? '登录服务暂时不可用，请稍后再试' : '抽奖服务暂时不可用，请稍后再试',
    },
    { status: unavailable ? 503 : 500 },
  )
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorized()
    const data = await getEntertainmentDailyDrawStatus(user.id)
    return NextResponse.json({ ok: true, data, error: null })
  } catch (error) {
    return serviceError(error, 'get')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) {
    return NextResponse.json({ ok: false, data: null, error: '请求来源校验失败，请刷新页面后重试' }, { status: 403 })
  }

  try {
    const user = await getCurrentUser()
    if (!user) return unauthorized()
    const result = await issueEntertainmentDailyDraw(user.id)
    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        todayDateKey: result.draw.dateKey,
        hasDrawn: true,
        remainingCount: 0,
      },
      error: null,
    })
  } catch (error) {
    return serviceError(error, 'post')
  }
}
