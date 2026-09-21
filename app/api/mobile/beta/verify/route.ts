import { NextResponse } from 'next/server'
import { BETA_INSTALLATION_HEADER, BETA_TOKEN_HEADER, verifyBetaCredential, betaErrorResponseForRoute } from '@/lib/mobile-beta'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const installationId = request.headers.get(BETA_INSTALLATION_HEADER) || ''
  const credential = request.headers.get(BETA_TOKEN_HEADER) || ''
  try {
    const result = await verifyBetaCredential({ credential, installationId })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    return betaErrorResponseForRoute(error, '内测验证服务暂时不可用，请稍后重试')
  }
}
