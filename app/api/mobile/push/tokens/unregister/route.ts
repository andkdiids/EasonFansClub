import { NextResponse } from 'next/server'
import { resolveMobileAccess } from '@/lib/mobile-auth'
import { consumeApiRateLimits, rateLimitResponse } from '@/lib/security'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Removes the user association for one push token on logout. Only the token's
 * current owner can unbind it; unknown or foreign tokens return ok without
 * leaking whether they exist.
 */
export async function POST(request: Request) {
  const auth = await resolveMobileAccess(request).catch(() => null)
  if (!auth) return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } })

  const input = record(await request.json().catch(() => null))
  const expoPushToken = typeof input.expoPushToken === 'string' ? input.expoPushToken.trim() : ''
  if (!expoPushToken || expoPushToken.length > 255) {
    return NextResponse.json({ ok: false, code: 'INVALID_PUSH_TOKEN_INPUT', message: '推送标识无效' }, { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }

  const rateLimit = await consumeApiRateLimits(request, auth.user.id, {
    endpoint: '/api/mobile/push/tokens/unregister',
    ip: { limit: 40, windowSeconds: 10 * 60 },
    user: { limit: 20, windowSeconds: 10 * 60 },
  })
  if (rateLimit.limited) return rateLimitResponse(rateLimit, '操作过于频繁，请稍后再试')

  try {
    const token = await prisma.mobilePushToken.findUnique({
      where: { expoPushToken },
      select: { id: true, userId: true },
    })
    if (token && token.userId === auth.user.id) {
      await prisma.mobilePushToken.update({
        where: { id: token.id },
        data: { userId: null, status: 'DISABLED', lastRegisteredAt: new Date() },
      })
    }
    return NextResponse.json({ ok: true, registered: false }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[mobile-push.unregister-failed]', { errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ ok: false, code: 'PUSH_UNREGISTER_FAILED', message: '推送解绑暂时不可用，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }
}
