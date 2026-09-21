import { NextResponse } from 'next/server'
import { activateBetaInvite, betaErrorResponseForRoute, hashInstallationId } from '@/lib/mobile-beta'
import { consumeApiRateLimits, rateLimitResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function POST(request: Request) {
  const input = record(await request.json().catch(() => null))
  const installationId = typeof input.installationId === 'string' ? input.installationId : ''
  const rateLimit = await consumeApiRateLimits(request, null, {
    endpoint: '/api/mobile/beta/activate',
    ip: { limit: 12, windowSeconds: 10 * 60 },
    account: { key: `installation:${installationId ? hashInstallationId(installationId.toLowerCase()) : 'missing'}`, limit: 8, windowSeconds: 10 * 60 },
  })
  if (rateLimit.limited) return rateLimitResponse(rateLimit, '尝试次数过多，请稍后再试')

  try {
    const result = await activateBetaInvite({ code: input.code, installationId })
    return NextResponse.json({ ok: true, credential: result.credential, expiresAt: result.expiresAt }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    return betaErrorResponseForRoute(error, '内测验证服务暂时不可用，请稍后重试')
  }
}
