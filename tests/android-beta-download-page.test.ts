import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { AndroidDownloadPageContent } from '../components/app/AndroidDownloadPageContent'
import { createBrandedQrBuffer } from '../lib/branded-qr-server'
import { ANDROID_BETA_DIRECT_DOWNLOAD_URL, ANDROID_BETA_DOWNLOAD_PAGE_PATH, ANDROID_BETA_DOWNLOAD_PAGE_URL, classifyAndroidDownloadVisitor, createAndroidDownloadPageModel, formatAndroidApkSize, formatAndroidPublishedDate, getAndroidDownloadContract } from '../lib/android-beta-download-page'
import { ANDROID_APP_DOWNLOAD_URL, type AppVersionManifest } from '../lib/app-version'

const validManifest: AppVersionManifest = {
  platform: 'android',
  versionName: '1.0.0-beta.21',
  versionCode: 22,
  minimumVersionCode: 19,
  forceUpdate: false,
  downloadUrl: ANDROID_APP_DOWNLOAD_URL,
  apkSha256: 'a'.repeat(64),
  size: 180836567,
  releaseNotes: ['分享支持图片卡片', '新增后台下载'],
  publishedAt: '2026-10-30T08:00:00.000Z',
}

test('landing and direct-download URLs use the stable ECFC routes', () => {
  assert.equal(ANDROID_BETA_DOWNLOAD_PAGE_PATH, '/app/android')
  assert.equal(ANDROID_BETA_DOWNLOAD_PAGE_URL, 'https://ecfc.fans/app/android')
  assert.equal(ANDROID_BETA_DIRECT_DOWNLOAD_URL, 'https://ecfc.fans/api/app/download/android')
  assert.deepEqual(getAndroidDownloadContract(), {
    landingPageUrl: ANDROID_BETA_DOWNLOAD_PAGE_URL,
    directDownloadUrl: ANDROID_BETA_DIRECT_DOWNLOAD_URL,
    directDownloadPath: '/api/app/download/android',
  })
})

test('page model passes through only validated current public metadata and formats size/date', () => {
  const model = createAndroidDownloadPageModel(validManifest, 'standard')
  assert.equal(model.status, 'available')
  if (model.status !== 'available') return
  assert.equal(model.manifest.versionName, validManifest.versionName)
  assert.equal(model.manifest.versionCode, 22)
  assert.deepEqual(model.manifest.releaseNotes, validManifest.releaseNotes)
  assert.equal(formatAndroidApkSize(validManifest.size), '172.46 MiB')
  assert.equal(formatAndroidPublishedDate(validManifest.publishedAt), '2026-10-30')
  assert.equal(formatAndroidPublishedDate(undefined), null)
  assert.equal(formatAndroidApkSize(0), null)
  assert.equal(formatAndroidApkSize(Number.MAX_SAFE_INTEGER + 1), null)
})

test('iOS receives no APK link; desktop and ordinary visitors can download; WeChat hint is platform-specific', () => {
  assert.equal(classifyAndroidDownloadVisitor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios')
  assert.equal(classifyAndroidDownloadVisitor('Mozilla/5.0 (Linux; Android 15) AppleWebKit MicroMessenger/8.0'), 'wechat-android')
  assert.equal(classifyAndroidDownloadVisitor('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'standard')
  assert.equal(classifyAndroidDownloadVisitor('Mozilla/5.0 (Macintosh; Intel Mac OS X)', '"iOS"'), 'ios')

  const iosHtml = renderToStaticMarkup(createElement(AndroidDownloadPageContent, {
    model: createAndroidDownloadPageModel(validManifest, 'ios'), qrDataUrl: null,
  }))
  assert.match(iosHtml, /仅适用于 Android/)
  assert.doesNotMatch(iosHtml, /href="https:\/\/ecfc\.fans\/api\/app\/download\/android"/)

  const desktopHtml = renderToStaticMarkup(createElement(AndroidDownloadPageContent, {
    model: createAndroidDownloadPageModel(validManifest, 'standard'), qrDataUrl: null,
  }))
  assert.match(desktopHtml, /href="https:\/\/ecfc\.fans\/api\/app\/download\/android"/)
  assert.match(desktopHtml, /1\.0\.0-beta\.21/)
  assert.match(desktopHtml, /172\.46 MiB/)
  assert.match(desktopHtml, /分享支持图片卡片/)
  assert.doesNotMatch(desktopHtml, /media\.ecfc\.fans|apkObjectKey/)

  const wechatHtml = renderToStaticMarkup(createElement(AndroidDownloadPageContent, {
    model: createAndroidDownloadPageModel(validManifest, 'wechat-android'), qrDataUrl: null,
  }))
  assert.match(wechatHtml, /在浏览器打开/)
})

test('invalid or unavailable metadata renders no stale version or download CTA', () => {
  const invalidManifest = { ...validManifest, downloadUrl: 'https://media.ecfc.fans/private.apk' }
  const model = createAndroidDownloadPageModel(invalidManifest, 'standard')
  assert.deepEqual(model, { status: 'unavailable', visitor: 'standard' })
  const html = renderToStaticMarkup(createElement(AndroidDownloadPageContent, { model, qrDataUrl: null }))
  assert.match(html, /版本信息暂时不可用/)
  assert.match(html, /不会显示旧版本/)
  assert.doesNotMatch(html, /1\.0\.0-beta\.21|api\/app\/download\/android/)
})

test('actual branded QR PNG scans to the permanent landing page, never the media object', async () => {
  const png = await createBrandedQrBuffer(ANDROID_BETA_DOWNLOAD_PAGE_URL, 320)
  const { default: sharp } = await import('sharp')
  const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true })
  const { createRequire } = await import('node:module')
  const path = await import('node:path')
  const requireFromScanner = createRequire(path.resolve('node_modules/@zxing/browser/package.json'))
  const zxing = requireFromScanner('@zxing/library') as {
    RGBLuminanceSource: new (data: Uint8ClampedArray, width: number, height: number) => unknown
    HybridBinarizer: new (source: unknown) => unknown
    BinaryBitmap: new (source: unknown) => unknown
    QRCodeReader: new () => { decode(bitmap: unknown): { getText(): string } }
  }
  const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))
  assert.equal(new zxing.QRCodeReader().decode(bitmap).getText(), ANDROID_BETA_DOWNLOAD_PAGE_URL)
})

test('landing page and middleware are dynamic/no-store, and page has no fixed RC metadata', () => {
  const page = readFileSync('app/app/android/page.tsx', 'utf8')
  const middleware = readFileSync('middleware.ts', 'utf8')
  const versionApi = readFileSync('app/api/app/version/route.ts', 'utf8')
  const downloadApi = readFileSync('app/api/app/download/android/route.ts', 'utf8')
  assert.match(page, /dynamic = 'force-dynamic'/)
  assert.match(page, /revalidate = 0/)
  assert.match(page, /parseAppVersionConfig\(process\.env\)/)
  assert.match(middleware, /'\/app\/android'/)
  assert.match(versionApi, /Cache-Control.*no-store/)
  assert.match(downloadApi, /createAndroidApkDownloadResponse/)
  assert.doesNotMatch(page, /beta\.\d+|RC\d+/i)
})
