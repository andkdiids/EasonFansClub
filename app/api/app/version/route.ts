import { NextResponse } from 'next/server'
import { parseAppVersionConfig, toPublicAppVersionManifest } from '@/lib/app-version'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function unavailableResponse() {
  return NextResponse.json(
    { code: 'APP_VERSION_UNAVAILABLE', message: '版本信息暂时不可用，请稍后重试' },
    { status: 503, headers: noStoreHeaders },
  )
}

export function GET(request: Request) {
  const platform = new URL(request.url).searchParams.get('platform')?.trim().toLowerCase()
  if (platform !== 'android') {
    return NextResponse.json(
      { code: 'APP_VERSION_PLATFORM_UNSUPPORTED', message: '暂不支持该平台' },
      { status: 400, headers: noStoreHeaders },
    )
  }

  const config = parseAppVersionConfig(process.env)
  if (!config) {
    console.error('[app.version] Android version configuration is unavailable or invalid')
    return unavailableResponse()
  }

  return NextResponse.json(toPublicAppVersionManifest(config), { headers: noStoreHeaders })
}
