import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { resolveMobileAccess } from '@/lib/mobile-auth'
import { consumeApiRateLimits, rateLimitResponse } from '@/lib/security'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const EXPO_PUSH_TOKEN_PATTERN = /^ExponentPushToken\[[a-zA-Z0-9._-]{8,}\]$/

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function invalid(message: string, code = 'INVALID_PUSH_TOKEN_INPUT') {
  return NextResponse.json({ ok: false, code, message }, { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

/**
 * Registers the current installation's Expo push token for the authenticated
 * mobile user. The token row is unique per Expo push token, so re-registering
 * (token rotation, app update, account switch) rebinds the token to the
 * caller: a token can only ever deliver for the user who last registered it.
 */
export async function POST(request: Request) {
  const auth = await resolveMobileAccess(request).catch(() => null)
  if (!auth) return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } })

  const input = record(await request.json().catch(() => null))
  const expoPushToken = typeof input.expoPushToken === 'string' ? input.expoPushToken.trim() : ''
  if (!expoPushToken || expoPushToken.length > 255 || !EXPO_PUSH_TOKEN_PATTERN.test(expoPushToken)) {
    return invalid('推送标识格式无效')
  }
  const installationId = typeof input.installationId === 'string' ? input.installationId.trim().slice(0, 64) : ''
  const appVersion = typeof input.appVersion === 'string' ? input.appVersion.trim().slice(0, 32) : ''
  const platform = input.platform === 'ios' ? 'ios' : input.platform === 'android' ? 'android' : ''

  const rateLimit = await consumeApiRateLimits(request, auth.user.id, {
    endpoint: '/api/mobile/push/tokens',
    ip: { limit: 40, windowSeconds: 10 * 60 },
    user: { limit: 20, windowSeconds: 10 * 60 },
  })
  if (rateLimit.limited) return rateLimitResponse(rateLimit, '注册过于频繁，请稍后再试')

  try {
    await prisma.mobilePushToken.upsert({
      where: { expoPushToken },
      create: {
        expoPushToken,
        userId: auth.user.id,
        installationId: installationId || null,
        platform,
        appVersion: appVersion || null,
        status: 'ACTIVE',
        failureCount: 0,
        lastFailureAt: null,
        lastFailureReason: null,
      },
      update: {
        userId: auth.user.id,
        installationId: installationId || null,
        platform,
        appVersion: appVersion || null,
        status: 'ACTIVE',
        failureCount: 0,
        lastFailureAt: null,
        lastFailureReason: null,
        lastRegisteredAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true, registered: true }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // A concurrent registration won the same token: the winner binds it.
      return NextResponse.json({ ok: true, registered: true }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
    }
    console.error('[mobile-push.register-failed]', { errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ ok: false, code: 'PUSH_REGISTER_FAILED', message: '推送注册暂时不可用，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }
}
