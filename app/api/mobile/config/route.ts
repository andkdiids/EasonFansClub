import { NextResponse } from 'next/server'
import { getBetaAccessConfig } from '@/lib/mobile-beta'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = await getBetaAccessConfig()
    return NextResponse.json(config, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[mobile.config]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ ok: false, code: 'MOBILE_CONFIG_UNAVAILABLE', message: '移动端配置暂时不可用，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }
}
