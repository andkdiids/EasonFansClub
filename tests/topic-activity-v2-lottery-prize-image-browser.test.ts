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
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityV2LotteryAdmin} from '@/components/activities/TopicActivityV2LotteryAdmin'; import {TopicActivityV2LotteryPublic} from '@/components/activities/TopicActivityV2LotteryPublic'; const mode=new URLSearchParams(location.search).get('mode'); const entries=[{id:'entry-weibo',platformName:'微博',title:'分享任务',enabled:true,maxImages:1}]; createRoot(document.getElementById('root')).render(mode==='admin'||mode==='participants'||mode==='drawn'?<TopicActivityV2LotteryAdmin activityId="activity-one" entries={entries}/>:<TopicActivityV2LotteryPublic activityId="activity-one" isAuthenticated={false}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
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
        const participantsLocked = currentMode === 'participants'
        const drawFrozen = currentMode === 'drawn'
        return send({ config: responseConfig, configLocked: participantsLocked, addressEncryptionReady: true, state: drawFrozen ? 'DRAWN' : 'COLLECTING', candidateCount: participantsLocked || drawFrozen ? 1 : 0, pendingSubmissionCount: 0, canShip: true, winners: [], draw: drawFrozen ? { id: 'draw-one', state: 'DRAWN', candidateCount: 1, winnerCount: 1, frozenAt: '2026-10-19T04:00:00.000Z', drawnAt: '2026-10-19T04:01:00.000Z' } : null })
      }
      if (request.method === 'PATCH') {
        const body = await json(request)
        lastPatchImageUrl = (body.config as { prizes?: Array<{ imageUrl?: unknown }> } | undefined)?.prizes?.[0]?.imageUrl
        savedConfig = normalizeTopicLotteryConfig(body.config)
        saveCount++
      }
      const participantsLocked = currentMode === 'participants'
      const drawFrozen = currentMode === 'drawn'
      return send({ config: savedConfig, configLocked: participantsLocked, addressEncryptionReady: true, state: drawFrozen ? 'DRAWN' : 'COLLECTING', candidateCount: participantsLocked || drawFrozen ? 1 : 0, pendingSubmissionCount: 0, canShip: true, winners: [], draw: drawFrozen ? { id: 'draw-one', state: 'DRAWN', candidateCount: 1, winnerCount: 1, frozenAt: '2026-10-19T04:00:00.000Z', drawnAt: '2026-10-19T04:01:00.000Z' } : null })
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
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  let browser: import('playwright').Browser
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw error
  }
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

    const participantsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await participantsContext.route('https://media.ecfc.fans/media/**', routePublicImage)
    const participantsPage = await participantsContext.newPage()
    await participantsPage.goto(`http://127.0.0.1:${port}/?mode=participants`)
    await participantsPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await participantsPage.getByText('候选资格：1', { exact: true }).waitFor()
    await participantsPage.getByText('奖品编号：prize-one', { exact: true }).waitFor()
    const existingPrize = participantsPage.locator('article').filter({ hasText: '奖品编号：prize-one' })
    assert.equal(await participantsPage.getByLabel('选择资格来源：微博 · 分享任务', { exact: true }).isDisabled(), true, 'eligibility rules stay locked after participation')
    assert.equal(await existingPrize.getByLabel('数量', { exact: true }).isDisabled(), true, 'existing stock is locked')
    assert.equal(await existingPrize.getByRole('button', { name: '移除奖品', exact: true }).isDisabled(), true, 'existing prize cannot be removed')
    assert.equal(await existingPrize.getByLabel('奖品图片（公开资源）上传文件', { exact: true }).isEnabled(), true, 'existing prize image remains editable')
    await existingPrize.getByLabel('奖品名称', { exact: true }).fill('参与后更新展示名称')
    await existingPrize.getByLabel('奖品说明', { exact: true }).fill('只更新已有奖品的展示文案')
    await existingPrize.getByLabel('奖品图片（公开资源）上传文件', { exact: true }).setInputFiles({ name: 'participant-prize.png', mimeType: 'image/png', buffer: imageBytes })
    await participantsPage.getByText('上传成功', { exact: true }).waitFor()
    await participantsPage.getByRole('button', { name: '添加奖品', exact: true }).click()
    const newPrize = participantsPage.locator('article').filter({ has: participantsPage.getByRole('heading', { name: '奖品 2', exact: true }) })
    assert.equal(await newPrize.getByLabel('数量', { exact: true }).isEnabled(), true, 'new prize stock can be configured')
    await newPrize.getByLabel('奖品名称', { exact: true }).fill('参与后新增奖品')
    await newPrize.getByLabel('奖品说明', { exact: true }).fill('新增奖品，不改动既有资格')
    await newPrize.getByLabel('数量', { exact: true }).fill('2')
    assert.equal(await newPrize.getByRole('button', { name: '移除奖品', exact: true }).isEnabled(), true, 'an unsaved newly added prize can be removed if needed')
    await participantsPage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).click()
    await participantsPage.getByText('实物抽奖配置已保存', { exact: false }).waitFor()
    assert.equal(savedConfig.prizes.length, 2)
    assert.equal(savedConfig.prizes[0].id, 'prize-one', 'existing prize identity remains stable')
    assert.equal(savedConfig.prizes[0].name, '参与后更新展示名称')
    assert.equal(savedConfig.prizes[1].quantity, 2)
    assert.equal(saveCount, 4)

    await participantsPage.reload()
    await participantsPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await participantsPage.getByLabel('选择资格来源：微博 · 分享任务', { exact: true }).waitFor()
    assert.equal(await participantsPage.getByLabel('选择资格来源：微博 · 分享任务', { exact: true }).isDisabled(), true)
    assert.equal(await participantsPage.getByLabel('奖品名称', { exact: true }).count(), 2)
    assert.equal(await participantsPage.locator('article').filter({ hasText: '奖品编号：prize-one' }).getByLabel('数量', { exact: true }).isDisabled(), true)
    assert.equal(await participantsPage.locator('article').filter({ has: participantsPage.getByRole('heading', { name: '奖品 2', exact: true }) }).getByLabel('数量', { exact: true }).isDisabled(), true, 'new prize stock locks after it has been saved into the pool')
    assert.equal(await participantsPage.locator('img[alt="奖品图片（公开资源）预览"]').count(), 1, 'uploaded image survives reload')
    await participantsPage.getByRole('button', { name: '移除', exact: true }).click()
    await participantsPage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).click()
    await participantsPage.getByText('实物抽奖配置已保存', { exact: false }).waitFor()
    assert.equal(savedConfig.prizes[0].imageUrl, null, 'existing prize image can be removed without deleting its slot')
    assert.equal(savedConfig.prizes[0].id, 'prize-one')
    assert.equal(savedConfig.prizes[0].quantity, 1)
    assert.equal(saveCount, 5)
    await participantsPage.reload()
    await participantsPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await participantsPage.getByText('奖品编号：prize-one', { exact: true }).waitFor()
    assert.equal(await participantsPage.locator('img[alt="奖品图片（公开资源）预览"]').count(), 0, 'removed image stays removed after reload')
    assert.equal(await participantsPage.getByText('候选资格：1', { exact: true }).count(), 1, 'participant eligibility remains unchanged by prize edits')
    await participantsContext.close()

    const drawnContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await drawnContext.route('https://media.ecfc.fans/media/**', routePublicImage)
    const drawnPage = await drawnContext.newPage()
    await drawnPage.goto(`http://127.0.0.1:${port}/?mode=drawn`)
    await drawnPage.getByRole('button', { name: '实物抽奖配置', exact: true }).click()
    await drawnPage.getByText('开奖快照已冻结', { exact: true }).waitFor()
    const drawnPrizeOne = drawnPage.locator('article').filter({ has: drawnPage.getByRole('heading', { name: '奖品 1', exact: true }) })
    const drawnPrizeTwo = drawnPage.locator('article').filter({ has: drawnPage.getByRole('heading', { name: '奖品 2', exact: true }) })
    assert.equal(await drawnPage.getByLabel('抽奖标题', { exact: true }).isDisabled(), true, 'drawn lottery title is frozen')
    assert.equal(await drawnPage.getByLabel('选择资格来源：微博 · 分享任务', { exact: true }).isDisabled(), true, 'drawn eligibility rules are frozen')
    assert.equal(await drawnPrizeOne.getByLabel('奖品名称', { exact: true }).isDisabled(), true, 'drawn existing prize display fields are frozen')
    assert.equal(await drawnPrizeOne.getByLabel('数量', { exact: true }).isDisabled(), true, 'drawn existing prize inventory is frozen')
    assert.equal(await drawnPrizeOne.getByLabel('奖品图片（公开资源）上传文件', { exact: true }).isDisabled(), true, 'drawn existing prize image editing is frozen')
    assert.equal(await drawnPrizeTwo.getByLabel('奖品名称', { exact: true }).isDisabled(), true, 'drawn added prize display fields are frozen')
    assert.equal(await drawnPrizeTwo.getByLabel('数量', { exact: true }).isDisabled(), true, 'drawn added prize inventory is frozen')
    assert.equal(await drawnPage.getByRole('button', { name: '添加奖品', exact: true }).isDisabled(), true, 'no prize can be added after drawing')
    assert.equal(await drawnPage.getByRole('button', { name: '保存实物抽奖配置', exact: true }).isDisabled(), true, 'drawn configuration cannot be saved')
    assert.equal(saveCount, 5, 'opening the drawn configuration does not write any changes')
    await drawnContext.close()
  } finally {
    adminGetGate.resolve()
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
