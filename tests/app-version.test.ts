import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { GET } from '../app/api/app/version/route'
import { createAndroidApkDownloadResponse } from '../lib/app-download'
import { ANDROID_APP_DOWNLOAD_URL, parseAppVersionConfig } from '../lib/app-version'

const environmentNames = [
  'ANDROID_VERSION_NAME',
  'ANDROID_VERSION_CODE',
  'ANDROID_MINIMUM_VERSION_CODE',
  'ANDROID_FORCE_UPDATE',
  'ANDROID_APK_COS_KEY',
  'ANDROID_APK_SHA256',
  'ANDROID_RELEASE_NOTES',
  'ANDROID_PUBLISHED_AT',
  'TENCENT_COS_SECRET_ID',
  'TENCENT_COS_SECRET_KEY',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
  'COS_BUCKET',
  'COS_REGION',
] as const

const validEnvironment = {
  ANDROID_VERSION_NAME: '1.0.0-beta.20',
  ANDROID_VERSION_CODE: '20',
  ANDROID_MINIMUM_VERSION_CODE: '19',
  ANDROID_FORCE_UPDATE: 'false',
  ANDROID_APK_COS_KEY: 'android/releases/ECFC-1.0.0-beta.20.apk',
  ANDROID_APK_SHA256: 'ab'.repeat(32),
  ANDROID_RELEASE_NOTES: '["优化每日处方显示","修复已知问题"]',
  ANDROID_PUBLISHED_AT: '2026-10-29T08:00:00Z',
  TENCENT_COS_SECRET_ID: 'test-only-not-a-credential',
  TENCENT_COS_SECRET_KEY: 'test-only-not-a-credential',
  TENCENT_COS_BUCKET: 'ecfc-test-1234567890',
  TENCENT_COS_REGION: 'ap-shanghai',
} as const

const publicApkUrl = 'https://media.ecfc.fans/media/android/releases/ECFC-1.0.0-beta.20.apk'

async function withVersionEnvironment(values: Readonly<Record<string, string | undefined>>, run: () => Promise<void>) {
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]))
  try {
    for (const name of environmentNames) {
      const value = values[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await run()
  } finally {
    for (const name of environmentNames) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('Android version config binds the digest to a fixed ECFC URL and keeps the COS object key private', () => {
  const config = parseAppVersionConfig(validEnvironment)
  assert.ok(config)
  assert.deepEqual(config, {
    platform: 'android',
    versionName: '1.0.0-beta.20',
    versionCode: 20,
    minimumVersionCode: 19,
    forceUpdate: false,
    downloadUrl: ANDROID_APP_DOWNLOAD_URL,
    apkSha256: 'ab'.repeat(32),
    apkObjectKey: 'android/releases/ECFC-1.0.0-beta.20.apk',
    releaseNotes: ['优化每日处方显示', '修复已知问题'],
    publishedAt: '2026-10-29T08:00:00.000Z',
  })
})

test('missing or unsafe APK/COS deployment config fails closed', () => {
  assert.equal(parseAppVersionConfig({}), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_VERSION_CODE: 'not-a-number' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_APK_SHA256: 'abc' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_APK_COS_KEY: '../private.apk' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_APK_COS_KEY: 'android/releases/a/../b.apk' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_APK_COS_KEY: 'android/releases//app.apk' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_APK_COS_KEY: 'https://example.test/app.apk' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, TENCENT_COS_SECRET_KEY: undefined }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, TENCENT_COS_REGION: undefined }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_MINIMUM_VERSION_CODE: '21' }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_VERSION_NAME: 'x'.repeat(81) }), null)
  assert.equal(parseAppVersionConfig({ ...validEnvironment, ANDROID_FORCE_UPDATE: 'yes' }), null)
})

test('version endpoint returns only the public manifest and hides the private COS key', async () => {
  await withVersionEnvironment(validEnvironment, async () => {
    const response = GET(new Request('https://ecfc.fans/api/app/version?platform=android'))
    assert.equal(response.status, 200)
    const body = await response.json() as Record<string, unknown>
    assert.equal(body.downloadUrl, ANDROID_APP_DOWNLOAD_URL)
    assert.equal(body.apkSha256, validEnvironment.ANDROID_APK_SHA256)
    assert.equal('apkObjectKey' in body, false)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  })

  await withVersionEnvironment({ ANDROID_VERSION_CODE: 'not-a-number' }, async () => {
    const response = GET(new Request('https://ecfc.fans/api/app/version?platform=android'))
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.deepEqual(body, { code: 'APP_VERSION_UNAVAILABLE', message: '版本信息暂时不可用，请稍后重试' })
    assert.doesNotMatch(JSON.stringify(body), /not-a-number/)
  })
})

test('version endpoint rejects non-Android platform before reading configuration', async () => {
  const response = GET(new Request('https://ecfc.fans/api/app/version?platform=ios'))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { code: 'APP_VERSION_PLATFORM_UNSUPPORTED', message: '暂不支持该平台' })
})

test('download endpoint redirects to the fixed public media origin after confirming the configured object', async () => {
  const config = parseAppVersionConfig(validEnvironment)
  assert.ok(config)
  const requestedKeys: string[] = []
  const response = await createAndroidApkDownloadResponse(new Request(ANDROID_APP_DOWNLOAD_URL), config, {
    objectExists: async (key) => { requestedKeys.push(key); return true },
  })
  assert.equal(response.status, 307)
  assert.equal(response.headers.get('location'), publicApkUrl)
  assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, max-age=0')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.deepEqual(requestedKeys, [config.apkObjectKey])
  assert.equal(await response.text(), '')
})

test('download endpoint rejects query injection and missing COS objects without leaking storage details', async () => {
  const config = parseAppVersionConfig(validEnvironment)
  assert.ok(config)
  const query = await createAndroidApkDownloadResponse(new Request(`${ANDROID_APP_DOWNLOAD_URL}?key=other.apk`), config, {
    objectExists: async () => true,
  })
  assert.equal(query.status, 400)

  const missing = await createAndroidApkDownloadResponse(new Request(ANDROID_APP_DOWNLOAD_URL), config, {
    objectExists: async () => false,
  })
  assert.equal(missing.status, 503)
  const responseText = await missing.text()
  assert.doesNotMatch(responseText, /android\/releases|myqcloud/)
})

test('download endpoint requires GET and configured deployment state', async () => {
  const config = parseAppVersionConfig(validEnvironment)
  assert.ok(config)
  const method = await createAndroidApkDownloadResponse(new Request(ANDROID_APP_DOWNLOAD_URL, { method: 'POST' }), config, {
    objectExists: async () => true,
  })
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('allow'), 'GET')
  const unavailable = await createAndroidApkDownloadResponse(new Request(ANDROID_APP_DOWNLOAD_URL), null, {
    objectExists: async () => { throw new Error('must not be called') },
  })
  assert.equal(unavailable.status, 503)
})

test('download endpoint rejects Range requests instead of claiming resume support', async () => {
  const config = parseAppVersionConfig(validEnvironment)
  assert.ok(config)
  const response = await createAndroidApkDownloadResponse(new Request(ANDROID_APP_DOWNLOAD_URL, { headers: { Range: 'bytes=0-' } }), config, {
    objectExists: async () => { throw new Error('must not be called') },
  })
  assert.equal(response.status, 416)
  assert.equal(response.headers.get('accept-ranges'), 'none')
})

test('middleware keeps both bootstrap version and fixed APK download routes public; the route checks COS and uses the fixed media origin', () => {
  const middleware = readFileSync('middleware.ts', 'utf8')
  const route = readFileSync('app/api/app/download/android/route.ts', 'utf8')
  assert.match(middleware, /['"]\/api\/app\/version['"]/)
  assert.match(middleware, /['"]\/api\/app\/download\/android['"]/)
  assert.match(route, /headCosObject/)
  assert.match(route, /createAndroidApkDownloadResponse/)
  assert.doesNotMatch(route, /getSignedCosObjectUrl/)
})
