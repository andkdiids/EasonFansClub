import { createAndroidApkDownloadResponse } from '@/lib/app-download'
import { parseAppVersionConfig } from '@/lib/app-version'
import { headCosObject } from '@/lib/tencent-cos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const config = parseAppVersionConfig(process.env)
  if (!config) {
    console.error('[app.download] Android APK configuration is unavailable or invalid')
  }
  return createAndroidApkDownloadResponse(request, config, {
    objectExists: headCosObject,
  })
}
