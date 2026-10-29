import { ANDROID_APP_DOWNLOAD_PATH, type AppVersionConfig } from '@/lib/app-version'

export type AndroidDownloadDependencies = {
  objectExists: (objectKey: string) => Promise<boolean>
}

const PUBLIC_APK_BASE_URL = 'https://media.ecfc.fans/media'

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function unavailable() {
  return Response.json(
    { code: 'APP_DOWNLOAD_UNAVAILABLE', message: '更新包暂时不可用，请稍后重试' },
    { status: 503, headers: noStoreHeaders },
  )
}

function publicApkUrl(objectKey: string) {
  try {
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/')
    const url = new URL(`${PUBLIC_APK_BASE_URL}/${encodedKey}`)
    return url.protocol === 'https:'
      && url.hostname === 'media.ecfc.fans'
      && !url.username
      && !url.password
      && !url.port
      && !url.hash
      && !url.search
      && url.pathname.startsWith('/media/android/releases/')
      && url.pathname.toLowerCase().endsWith('.apk')
      ? url.toString()
      : null
  } catch {
    return null
  }
}

/** Redirects only to the configured, existing APK object through ECFC's public media origin. */
export async function createAndroidApkDownloadResponse(
  request: Request,
  config: AppVersionConfig | null,
  dependencies: AndroidDownloadDependencies,
) {
  const requestUrl = new URL(request.url)
  if (requestUrl.pathname !== ANDROID_APP_DOWNLOAD_PATH || requestUrl.search || requestUrl.hash) {
    return Response.json({ code: 'APP_DOWNLOAD_REQUEST_INVALID', message: '下载请求无效' }, { status: 400, headers: noStoreHeaders })
  }
  if (request.method !== 'GET') {
    return Response.json({ code: 'APP_DOWNLOAD_METHOD_NOT_ALLOWED', message: '请求方法不支持' }, {
      status: 405,
      headers: { ...noStoreHeaders, Allow: 'GET' },
    })
  }
  if (request.headers.has('range')) {
    return new Response(null, {
      status: 416,
      headers: { ...noStoreHeaders, 'Accept-Ranges': 'none' },
    })
  }
  if (!config) return unavailable()

  try {
    if (!await dependencies.objectExists(config.apkObjectKey)) return unavailable()
    const mediaUrl = publicApkUrl(config.apkObjectKey)
    if (!mediaUrl) return unavailable()
    return new Response(null, {
      status: 307,
      headers: { ...noStoreHeaders, Location: mediaUrl },
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'COS_UNAVAILABLE'
    console.error('[app.download] Android APK redirect unavailable', { code })
    return unavailable()
  }
}
