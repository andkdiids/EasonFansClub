import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { AndroidDownloadPageContent } from '@/components/app/AndroidDownloadPageContent'
import { createBrandedQrBuffer } from '@/lib/branded-qr-server'
import { classifyAndroidDownloadVisitor, createAndroidDownloadPageModel, ANDROID_BETA_DOWNLOAD_PAGE_PATH, ANDROID_BETA_DOWNLOAD_PAGE_URL } from '@/lib/android-beta-download-page'
import { parseAppVersionConfig, toPublicAppVersionManifest } from '@/lib/app-version'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Android 内测版下载',
  description: '私家E院 Android 内测版的当前版本信息与官方下载入口。',
  alternates: { canonical: ANDROID_BETA_DOWNLOAD_PAGE_PATH },
  robots: { index: false, follow: true },
}

export default async function AndroidBetaDownloadPage() {
  const requestHeaders = await headers()
  const visitor = classifyAndroidDownloadVisitor(
    requestHeaders.get('user-agent') || '',
    requestHeaders.get('sec-ch-ua-platform') || '',
  )
  const config = parseAppVersionConfig(process.env)
  const manifest = config ? toPublicAppVersionManifest(config) : null
  const model = createAndroidDownloadPageModel(manifest, visitor)

  let qrDataUrl: string | null = null
  try {
    const qr = await createBrandedQrBuffer(ANDROID_BETA_DOWNLOAD_PAGE_URL, 320)
    qrDataUrl = `data:image/png;base64,${qr.toString('base64')}`
  } catch (error) {
    console.error('[android.download-page.qr]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
  }

  return <AndroidDownloadPageContent model={model} qrDataUrl={qrDataUrl} />
}
