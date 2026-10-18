import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { normalizeTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

test('Topic V2 lottery prize upload persists and resolves for admin and anonymous public views', { skip: process.env.TOPIC_V2_LOTTERY_PRIZE_IMAGE_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const resolveFromApp = createRequire(join(process.cwd(), 'package.json'))
  const reactPath = resolveFromApp.resolve('react')
  const jsxRuntimePath = resolveFromApp.resolve('react/jsx-runtime')
  const reactDomPath = resolveFromApp.resolve('react-dom')
  const reactDomClientPath = resolveFromApp.resolve('react-dom/client')
  const schedulerPath = join(process.cwd(), 'node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler/index.js')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityV2LotteryAdmin} from '@/components/activities/TopicActivityV2LotteryAdmin'; import {TopicActivityV2LotteryPublic} from '@/components/activities/TopicActivityV2LotteryPublic'; const mode=new URLSearchParams(location.search).get('mode'); const entries=[{id:'entry-weibo',platformName:'微博',title:'分享任务',enabled:true,maxImages:1}]; createRoot(document.getElementById('root')).render(mode==='admin'?<TopicActivityV2LotteryAdmin activityId="activity-one" entries={entries}/>:<TopicActivityV2LotteryPublic activityId="activity-one" isAuthenticated={false}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), nodePaths: [join(process.cwd(), 'node_modules')], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '"https://media.ecfc.fans/media"' },
    plugins: [{ name: 'lottery-prize-image-browser-fixture', setup(buildPlugin: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path?: string; namespace?: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void }) {
      buildPlugin.onResolve({ filter: /^@\// }, (args) => {
        const base = join(process.cwd(), args.path.slice(2))
        const source = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js'].find((candidate) => existsSync(candidate))
        return { path: source || base }
      })
      buildPlugin.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
      buildPlugin.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: jsxRuntimePath }))
      buildPlugin.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
      buildPlugin.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: reactDomClientPath }))
      buildPlugin.onResolve({ filter: /^scheduler$/ }, () => ({ path: schedulerPath }))
      buildPlugin.onResolve({ filter: /^\.\// }, (args) => {
        const base = join(args.resolveDir, args.path)
        const source = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js'].find((candidate) => existsSync(candidate))
        return source ? { path: source } : {}
      })
      buildPlugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'lottery-fixture' }))
      buildPlugin.onLoad({ filter: /.*/, namespace: 'lottery-fixture' }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })

  const json = async (request: import('node:http').IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>
  }
  const initialConfig = normalizeTopicLotteryConfig({ version: 1, enabled: true, title: '幸运抽奖', description: '完成平台任务后获得资格。', mode: 'MANUAL',
    drawAt: '2099-10-20T04:00:00.000Z', eligibilityDeadline: '2099-10-19T04:00:00.000Z', addressDeadline: '2099-10-25T04:00:00.000Z',
    publishWinners: false, retentionDays: 90, sourceEntryIds: ['entry-weibo'], prizes: [{ id: 'prize-one', name: '限定明信片', description: '', imageUrl: null, quantity: 1, sortOrder: 0 }] })
  let savedConfig = initialConfig
  let uploadCount = 0
  let saveCount = 0
  let lastPatchImageUrl: unknown = null
  let anonymousRequestHadCookie = false
  let currentMode = ''
  let holdNextAdminGet = false
  const adminGetStarted = createDeferred()
  const adminGetGate = createDeferred()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    currentMode = url.searchParams.get('mode') || currentMode
    const send = (body: unknown, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)) }
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(build.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end('*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif}button,input,textarea,select{font:inherit}img{max-width:100%;display:block}.max-h-44{max-height:11rem}.w-full{width:100%}.object-cover{object-fit:cover}'); return }
    if (url.pathname === '/api/uploads/activity-image' && request.method === 'POST') {
      for await (const chunk of request) void chunk
      uploadCount++
      return send({ url: 'https://media.ecfc.fans/media/activities/uploaded-prize/source.webp', mimeType: 'image/webp', format: 'webp' })
    }
    if (url.pathname === '/api/admin/activities/activity-one/v2/lottery') {
      if (request.method === 'GET') {
        const responseConfig = savedConfig
        if (holdNextAdminGet) {
          holdNextAdminGet = false
          adminGetStarted.resolve()
          await adminGetGate.promise
        }
        return send({ config: responseConfig, configLocked: false, addressEncryptionReady: true, state: 'COLLECTING', candidateCount: 0, pendingSubmissionCount: 0, canShip: true, winners: [], draw: null })
      }
      if (request.method === 'PATCH') {
        const body = await json(request)
        lastPatchImageUrl = (body.config as { prizes?: Array<{ imageUrl?: unknown }> } | undefined)?.prizes?.[0]?.imageUrl
        savedConfig = normalizeTopicLotteryConfig(body.config)
        saveCount++
      }
      return send({ config: savedConfig, configLocked: false, addressEncryptionReady: true, state: 'COLLECTING', candidateCount: 0, pendingSubmissionCount: 0, canShip: true, winners: [], draw: null })
    }
    if (url.pathname === '/api/activities/activity-one/v2/lottery') {
      if (currentMode === 'public-anonymous' && request.headers.cookie) anonymousRequestHadCookie = true
      return send({ enabled: true, config: savedConfig, state: 'COLLECTING', candidateCount: 0, myStatus: 'LOGIN_REQUIRED', myEligibility: null, myWinner: null, winners: [] })
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
  const imageBytes = readFileSync(join(process.cwd(), 'public/images/og-default.png'))
  const routePublicImage = (route: import('playwright').Route) => route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes })
  try {
    const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await adminContext.route('https://media.ecfc.fans/media/**', routePublicImage)
    const adminPage = await adminContext.newPage()
    await adminPage.goto(`http://127.0.0.1:${port}/?mode=admin`)
    await adminPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await adminPage.getByText('奖品编号：prize-one', { exact: true }).waitFor()
    holdNextAdminGet = true
    const staleRefreshRequest = adminPage.waitForRequest((request) => request.method() === 'GET' && request.url().includes('/api/admin/activities/activity-one/v2/lottery'))
    await adminPage.evaluate(() => window.dispatchEvent(new Event('focus')))
    await staleRefreshRequest
    await adminGetStarted.promise
    const uploadInput = adminPage.getByLabel('奖品图片（公开资源）上传文件', { exact: true })
    await uploadInput.setInputFiles({ name: 'prize.png', mimeType: 'image/png', buffer: imageBytes })
    await adminPage.getByText('上传成功', { exact: true }).waitFor()
    const uploadedPreview = adminPage.locator('img[alt="奖品图片（公开资源）预览"]')
    await adminPage.waitForFunction(() => {
      const image = document.querySelector('img[alt="奖品图片（公开资源）预览"]')
      return image instanceof HTMLImageElement && image.src.endsWith('/activities/uploaded-prize/card.webp')
    })
    assert.match(await uploadedPreview.getAttribute('src') || '', /\/activities\/uploaded-prize\/card\.webp$/u)
    const staleRefreshResponse = adminPage.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/api/admin/activities/activity-one/v2/lottery'))
    adminGetGate.resolve()
    await staleRefreshResponse
    await adminPage.waitForFunction(() => {
      const image = document.querySelector('img[alt="奖品图片（公开资源）预览"]')
      return image instanceof HTMLImageElement && image.src.endsWith('/activities/uploaded-prize/card.webp')
    })
    await adminPage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).click()
    await adminPage.getByText('实物抽奖配置已保存', { exact: false }).waitFor()
    assert.equal(uploadCount, 1)
    assert.equal(saveCount, 1)
    assert.equal(savedConfig.prizes[0].imageUrl, '/cos/activities/uploaded-prize/source.webp', `save writes the stable uploaded object reference (patch=${String(lastPatchImageUrl)})`)

    await adminPage.reload()
    await adminPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await adminPage.waitForFunction(() => {
      const image = document.querySelector('img[alt="奖品图片（公开资源）预览"]')
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    })
    const adminImage = adminPage.locator('img[alt="奖品图片（公开资源）预览"]').first()
    assert.match(await adminImage.getAttribute('src') || '', /\/activities\/uploaded-prize\/card\.webp$/u)
    await adminPage.getByLabel('奖品名称', { exact: true }).fill('限定周年明信片')
    await adminPage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).click()
    await adminPage.getByText('实物抽奖配置已保存', { exact: false }).waitFor()
    assert.equal(savedConfig.prizes[0].imageUrl, '/cos/activities/uploaded-prize/source.webp', 'editing other prize fields preserves its image reference')
    assert.equal(saveCount, 2)
    await adminContext.close()

    const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await publicContext.route('https://media.ecfc.fans/media/**', routePublicImage)
    const publicPage = await publicContext.newPage()
    await publicPage.goto(`http://127.0.0.1:${port}/?mode=public-anonymous`)
    await publicPage.getByRole('heading', { name: '幸运抽奖', exact: true }).waitFor()
    await publicPage.waitForFunction(() => {
      const image = document.querySelector('img[src*="uploaded-prize/source.webp"]')
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    })
    assert.equal(anonymousRequestHadCookie, false, 'public prize image is visible in a fresh anonymous session')
    await publicContext.close()

    const deleteContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await deleteContext.route('https://media.ecfc.fans/media/**', routePublicImage)
    const deletePage = await deleteContext.newPage()
    await deletePage.goto(`http://127.0.0.1:${port}/?mode=admin`)
    await deletePage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await deletePage.getByText('奖品编号：prize-one', { exact: true }).waitFor()
    await deletePage.getByRole('button', { name: '移除', exact: true }).click()
    await deletePage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).click()
    await deletePage.getByText('实物抽奖配置已保存', { exact: false }).waitFor()
    assert.equal(savedConfig.prizes[0].imageUrl, null, 'removing an image clears only the prize reference')
    await deletePage.reload()
    await deletePage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await deletePage.getByText('奖品编号：prize-one', { exact: true }).waitFor()
    assert.equal(await deletePage.locator('img[alt="奖品图片（公开资源）预览"]').count(), 0, 'removed image stays removed after reload')
    assert.equal(saveCount, 3)
    await deleteContext.close()
  } finally {
    adminGetGate.resolve()
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
