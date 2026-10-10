import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'

async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(label)
}

type FixtureAsset = {
  assetId: string
  storageKey: string
  mimeType: string
  width: number
  height: number
  size: number
  url: string
  thumbnailUrl: string
  previewAccessUrl: string
  thumbnailAccessUrl: string
}

const ASSET_URL = '/api/activities/fixture/assets/asset-1/preview'
const REPLY_ASSET_1_URL = '/api/activities/fixture/assets/reply-asset-1/preview?variant=thumbnail'
const REPLY_ASSET_2_URL = '/api/activities/fixture/assets/reply-asset-2/preview?variant=thumbnail'
const ORIGINAL_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64')

function asset(assetId: string, url: string): FixtureAsset {
  return { assetId, storageKey: `topic-activity/fixture/replies/${assetId}/source.webp`, mimeType: 'image/webp', width: 1, height: 1, size: ORIGINAL_BYTES.byteLength, url, thumbnailUrl: url, previewAccessUrl: url, thumbnailAccessUrl: url }
}

test('V6.1.2 browser media: bounded auth retry and stable reply asset URLs', { skip: process.env.TOPIC_V612_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const result = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityAssetImage} from './components/activities/TopicActivityAssetImage'; import {TopicActivityFormParticipation} from './components/activities/TopicActivityFormParticipation'; import {TopicActivityFormSubmissionManager} from './app/admin/activities/TopicActivityFormSubmissionManager'; createRoot(document.getElementById('root')).render(location.pathname==='/admin'?<TopicActivityFormSubmissionManager activityId="fixture" onClose={()=>{}}/>:location.pathname==='/user'?<TopicActivityFormParticipation activityId="fixture" isAuthenticated={true}/>:<TopicActivityAssetImage src="${ASSET_URL}" alt="fixture image" className="fixture-image"/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"' },
  })

  const replyAsset1 = asset('reply-asset-1', REPLY_ASSET_1_URL)
  const replyAsset2 = asset('reply-asset-2', REPLY_ASSET_2_URL)
  const userAsset = asset('asset-1', ASSET_URL)
  const userAttachment = asset('attachment-1', '/api/activities/fixture/assets/attachment-1/preview')
  const userSubmission = { id: 'submission-1', status: 'SUBMITTED', submittedAt: '2026-10-08T00:00:01.000Z', answersSnapshot: [{ fieldId: 'proof', label: '截图', type: 'IMAGE', value: [userAsset] }], attachments: [userAttachment], replies: [], }
  const rows = [
    { id: 'form-1', status: 'REPLIED', submittedAt: '2026-10-08T00:00:01.000Z', answersSnapshot: [], attachments: [], replies: [{ id: 'reply-1', content: '第一份回复', createdAt: '2026-10-08T00:00:02.000Z', images: [replyAsset1] }], user: { id: 'user-1', nickname: '用户一', avatarUrl: null } },
    { id: 'form-2', status: 'REPLIED', submittedAt: '2026-10-08T00:00:03.000Z', answersSnapshot: [], attachments: [], replies: [{ id: 'reply-2', content: '第二份回复', createdAt: '2026-10-08T00:00:04.000Z', images: [replyAsset2] }], user: { id: 'user-2', nickname: '用户二', avatarUrl: null } },
  ]
  let freshAuth = false
  const previewRequests: Array<{ path: string; fresh: boolean }> = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const json = (value: unknown, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(result.outputFiles[0].text); return }
    if (url.pathname.startsWith('/api/activities/fixture/assets/')) {
      const hasFreshCookie = String(request.headers.cookie || '').includes('fixture-auth=fresh')
      previewRequests.push({ path: url.pathname + url.search, fresh: hasFreshCookie })
      if (!freshAuth || !hasFreshCookie) { json({ message: '请登录后查看图片' }, 401); return }
      response.setHeader('Content-Type', 'image/png')
      response.setHeader('Cache-Control', 'private, no-store')
      response.end(ORIGINAL_BYTES)
      return
    }
    if (url.pathname === '/api/admin/activities/fixture/form-submissions') {
      json({ submissions: rows, total: rows.length, nextCursor: null, page: 1, hasMore: false, counts: { formSubmissions: rows.length, repliedForms: rows.length, unrepliedForms: 0, commentSubmissions: 0, approvedUsers: 0 } })
      return
    }
    if (url.pathname === '/api/activities/fixture/form') {
      json({ activity: { startsAt: null, endsAt: null, activityPostId: null, allowImageAttachments: true }, schema: { version: 1, fields: [{ id: 'proof', label: '截图', type: 'IMAGE', required: false, maxImages: 1 }] } })
      return
    }
    if (url.pathname === '/api/activities/fixture/my-form-submissions') {
      json({ submissions: [userSubmission], total: 1, page: 1, hasMore: false })
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><meta charset="utf-8"><style>button{min-height:40px}body{margin:12px}</style><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  let browser: Browser | null = null
  try {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await context.addInitScript(() => {
      let offset = 0
      const realNow = Date.now.bind(Date)
      const target = window as Window & { advanceFixtureClock?: (milliseconds: number) => void }
      target.advanceFixtureClock = (milliseconds) => { offset += milliseconds }
      Date.now = () => realNow() + offset
    })

    const mediaPage = await context.newPage()
    await mediaPage.goto(origin)
    await until(() => mediaPage.getByRole('alert').isVisible(), 'bounded media error is visible')
    assert.equal(previewRequests.length, 2, 'only initial request and one automatic retry occur before manual action')
    assert.deepEqual(previewRequests.map((item) => item.path), [ASSET_URL, `${ASSET_URL}?previewRetry=1`])

    freshAuth = true
    await context.addCookies([{ name: 'fixture-auth', value: 'fresh', url: origin }])
    await mediaPage.getByRole('button', { name: '重新加载图片', exact: true }).click()
    const mediaImage = mediaPage.getByRole('img', { name: 'fixture image', exact: true })
    await until(async () => await mediaImage.isVisible() && await mediaImage.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0), 'manual fresh-auth media retry has pixels')
    assert.equal(previewRequests.length, 3)
    assert.equal(previewRequests[2].path, `${ASSET_URL}?previewRetry=2`, 'manual retry gets a fresh unique URL')
    assert.equal(previewRequests[2].fresh, true)
    await mediaPage.close()

    await context.clearCookies()
    freshAuth = false
    const userPage = await context.newPage()
    await userPage.goto(origin + '/user')
    await until(() => userPage.getByRole('button', { name: '查看已提交表单', exact: true }).isVisible(), 'user submission detail is available')
    await userPage.getByRole('button', { name: '查看已提交表单', exact: true }).click()
    await until(async () => await userPage.getByRole('alert').count() === 2, 'user detail field and global attachment errors are visible')
    const userRequestStart = previewRequests.length - 4
    assert.equal(previewRequests.slice(userRequestStart).length, 4)
    assert.equal(previewRequests.slice(userRequestStart).filter((item) => item.path === ASSET_URL).length, 1)
    assert.equal(previewRequests.slice(userRequestStart).filter((item) => item.path === `${ASSET_URL}?previewRetry=1`).length, 1)
    assert.equal(previewRequests.slice(userRequestStart).filter((item) => item.path === userAttachment.url).length, 1)
    assert.equal(previewRequests.slice(userRequestStart).filter((item) => item.path === `${userAttachment.url}?previewRetry=1`).length, 1)
    freshAuth = true
    await context.addCookies([{ name: 'fixture-auth', value: 'fresh', url: origin }])
    const reloadButtons = userPage.getByRole('button', { name: '重新加载图片', exact: true })
    assert.equal(await reloadButtons.count(), 2)
    await reloadButtons.nth(1).click()
    await reloadButtons.nth(0).click()
    const userImage = userPage.getByRole('img', { name: '表单字段图片', exact: true })
    const attachmentImage = userPage.getByRole('img', { name: '表单图片附件', exact: true })
    await until(async () => await userImage.isVisible() && await userImage.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0), 'user IMAGE field can reload the same private asset')
    await until(async () => await attachmentImage.isVisible() && await attachmentImage.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0), 'user global attachment can reload the private asset')
    const userManualRetries = previewRequests.slice(userRequestStart).filter((item) => item.path.endsWith('previewRetry=2'))
    assert.equal(userManualRetries.length, 2)
    assert.ok(userManualRetries.every((item) => item.fresh))
    await userPage.close()

    const managerPage = await context.newPage()
    await managerPage.goto(origin + '/admin')
    await until(async () => await managerPage.locator('article').count() === 2, 'admin media list loaded')
    await managerPage.locator('#admin-form-form-1').getByRole('button', { name: '查看详情 / 回复' }).click()
    const replyImage1 = managerPage.locator('#admin-form-form-1 img[alt="回复附件"]')
    await until(async () => await replyImage1.isVisible() && await replyImage1.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0), 'first reply image has pixels')
    const firstReplyUrl = await replyImage1.getAttribute('src')
    assert.equal(firstReplyUrl, REPLY_ASSET_1_URL)
    assert.doesNotMatch(firstReplyUrl || '', /Signature|Expires|sign=/iu)

    await managerPage.locator('#admin-form-form-2').getByRole('button', { name: '查看详情 / 回复' }).click()
    const replyImage2 = managerPage.locator('#admin-form-form-2 img[alt="回复附件"]')
    await until(async () => await replyImage2.isVisible() && await replyImage2.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0), 'second reply image has pixels after switching')
    const secondReplyUrl = await replyImage2.getAttribute('src')
    assert.equal(secondReplyUrl, REPLY_ASSET_2_URL)
    assert.doesNotMatch(secondReplyUrl || '', /Signature|Expires|sign=/iu)

    await managerPage.evaluate(() => (window as Window & { advanceFixtureClock?: (milliseconds: number) => void }).advanceFixtureClock?.(5 * 60 * 1000))
    await managerPage.locator('#admin-form-form-1').getByRole('button', { name: '查看详情 / 回复' }).click()
    const reopenedReplyImage1 = managerPage.locator('#admin-form-form-1 img[alt="回复附件"]')
    await until(async () => await reopenedReplyImage1.isVisible() && await reopenedReplyImage1.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0), 'first reply image has pixels after five-minute reopen')
    assert.equal(await reopenedReplyImage1.getAttribute('src'), firstReplyUrl, 'asset-id proxy URL remains stable after five minutes and list switching')
    await context.close()
  } finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
