import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Page } from 'playwright'
import sharp from 'sharp'
import COS from 'cos-nodejs-sdk-v5'
import { createDefaultTopicActivityV2Program, publicTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'

test('real edit wizard saves uploaded non-first result background with legacy nullable fields and real PNG preview/download/share', { skip: process.env.TOPIC_V2_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>
  }
  const reactDomClient = require.resolve('react-dom/client')
  const resolved = new Map([
    ['react', require.resolve('react')], ['react/jsx-runtime', require.resolve('react/jsx-runtime')],
    ['react-dom', require.resolve('react-dom')], ['react-dom/client', reactDomClient],
    ['scheduler', createRequire(reactDomClient).resolve('scheduler')],
  ])
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TopicActivityWizard} from './components/activities/TopicActivityWizard';import {TopicActivityV2TestRunner} from './components/activities/TopicActivityV2Interactive';const runner=new URLSearchParams(location.search).get('runner');createRoot(document.getElementById('root')).render(runner?<TopicActivityV2TestRunner activityId="background-edit" isAuthenticated={true}/>:<TopicActivityWizard open={true} mode="EDIT" activityId="background-edit" onClose={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), nodePaths: [join(process.cwd(), 'node_modules')], bundle: true,
    write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '"https://media.ecfc.fans/media"' },
    plugins: [{ name: 'isolated-edit-fixture', setup(builder: {
      onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path?: string; namespace?: string }) => void
      onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void
    }) {
      builder.onResolve({ filter: /^(react(?:\/jsx-runtime)?|react-dom(?:\/client)?|scheduler)$/ }, (args) => ({ path: resolved.get(args.path)! }))
      builder.onResolve({ filter: /^@\// }, (args) => {
        const base = join(process.cwd(), args.path.slice(2))
        return { path: [base, base + '.tsx', base + '.ts'].find(existsSync) || base }
      })
      builder.onResolve({ filter: /^\.\// }, (args) => {
        const base = join(args.resolveDir, args.path)
        const source = [base, base + '.tsx', base + '.ts', base + '.js'].find(existsSync)
        return source ? { path: source } : {}
      })
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'local-link' }))
      builder.onLoad({ filter: /.*/, namespace: 'local-link' }, () => ({ contents: 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}', loader: 'js', resolveDir: process.cwd() }))
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'local-navigation' }))
      builder.onLoad({ filter: /.*/, namespace: 'local-navigation' }, () => ({ contents: 'export function useRouter(){return {refresh(){},push(){}}}export function usePathname(){return "/fixture"}export function useSearchParams(){return new URLSearchParams(location.search)}', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const css = (await require('postcss')([require('tailwindcss')({ ...require('./tailwind.config.ts').default,
    content: [{ raw: bundle.outputFiles[0].text, extension: 'js' }],
  })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css as string
  const uploadedPath = '/cos/activities/00000000-0000-4000-8000-000000000001/source.webp'
  const background = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#3bd38b' } }).png().toBuffer()
  // Exercise the real COS path resolver while replacing only the SDK's network boundary.
  const envNames = ['TENCENT_COS_SECRET_ID', 'TENCENT_COS_SECRET_KEY', 'TENCENT_COS_BUCKET', 'TENCENT_COS_REGION'] as const
  const oldEnv = envNames.map((name) => process.env[name])
  envNames.forEach((name) => { process.env[name] = 'local-browser-fixture-not-a-credential' })
  function localGetObject(params: COS.GetObjectParams, callback: (error: COS.CosError, value: COS.GetObjectResult) => void): void
  function localGetObject(params: COS.GetObjectParams): Promise<COS.GetObjectResult>
  function localGetObject(params: COS.GetObjectParams, callback?: (error: COS.CosError, value: COS.GetObjectResult) => void): void | Promise<COS.GetObjectResult> {
    assert.equal(params.Key, uploadedPath.slice('/cos/'.length))
    const value: COS.GetObjectResult = { Body: background, ETag: 'local-fixture' }
    if (callback) { callback(null, value); return }
    return Promise.resolve(value)
  }
  t.mock.method(COS.prototype, 'getObject', localGetObject)
  const requests: string[] = []
  const activity = { id: 'background-edit', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', title: '现有活动', description: '现有介绍',
    startsAt: null, endsAt: null, participationRule: null, participationMode: 'COMMENT', allowImageAttachments: true, coverUrl: null }
  let program = createDefaultTopicActivityV2Program()
  program.enabled = true
  program.test = { ...program.test, enabled: true, id: 'existing-test', title: '原有测试', version: 7, mode: 'KNOWLEDGE',
    questions: [{ id: 'existing-question', prompt: '原有题目', points: 2, correctOptionId: 'correct', options: [{ id: 'correct', label: '正确' }, { id: 'other', label: '其他' }] }],
    results: [{ id: 'result-one', title: '结果一', description: '第一结果', scoreMin: 0, scoreMax: 1 },
      { id: 'result-two', title: '结果二', description: '第二结果', scoreMin: 2, scoreMax: 2 }],
    poster: { ...program.test.poster, showNickname: true, showQrCode: true } }
  const questionsBefore = structuredClone(program.test.questions)
  const initialProgram = structuredClone(program)
  const frozenAttempt = { id: 'historical-attempt', testId: 'existing-test', configVersion: 7, resultId: 'result-two', completedAt: '2026-10-17T00:00:00Z',
    resultSnapshot: { resultId: 'result-two', title: '结果二', description: '第二结果', imageUrl: null, nickname: '历史昵称', testTitle: '原有测试',
      poster: { showNickname: true, showQrCode: true } } }
  const frozenBefore = structuredClone(frozenAttempt)
  let writes = 0, posterRequests = 0
  let servedPng: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    try {
      if (url.pathname.startsWith('/api/')) requests.push(`${req.method} ${url.pathname}`)
      if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
      if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
      if (url.pathname === uploadedPath) { res.setHeader('Content-Type', 'image/png'); res.end(background); return }
      if (url.pathname === '/icons/icon-512.png') { res.setHeader('Content-Type', 'image/png'); res.end(readFileSync('public/icons/icon-512.png')); return }
      if (url.pathname === '/api/uploads/activity-image' && req.method === 'POST') {
        // Controlled local storage adapter only; no COS request or real user file is uploaded.
        for await (const chunk of req) { assert.ok(chunk) }
        return send({ url: uploadedPath })
      }
      if (url.pathname === '/api/admin/activities/background-edit') {
        assert.equal(req.method, 'GET', 'presentation-only edit does not rewrite base activity')
        return send({ activity })
      }
      if (url.pathname === '/api/admin/activities/background-edit/v2') {
        if (req.method === 'PATCH') {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
          const payload = JSON.parse(Buffer.concat(chunks).toString())
          assert.deepEqual(Object.keys(payload), ['program'])
          program = payload.program; writes++
        }
        // Match the real module DTO: this activity projection has no type property.
        return send({ activity: { id: activity.id, title: activity.title, status: activity.status, activityPostId: null }, program,
          statistics: { testParticipants: 3 }, canReview: true })
      }
      if (url.pathname === '/api/admin/activities/background-edit/v2/lottery') {
        assert.equal(req.method, 'GET', 'poster save cannot modify lottery configuration')
        return send({ config: defaultTopicLotteryConfig(), configLocked: false, addressEncryptionReady: false, state: 'DISABLED', candidateCount: 0, pendingSubmissionCount: 0, draw: null, winners: [], canShip: false })
      }
      if (url.pathname.endsWith('/v2/test')) return send({ activity: { title: activity.title }, test: publicTopicActivityV2Program(program).test })
      if (url.pathname.endsWith('/v2/attempts')) return send({ attempts: [frozenAttempt] })
      if (url.pathname.endsWith('/poster')) {
        posterRequests++
        const currentResult = program.test.results.find((row) => row.id === frozenAttempt.resultId)
        assert.equal(currentResult?.imageUrl, uploadedPath)
        // The real renderer reads the saved COS reference; only its SDK network operation is mocked.
        // Current presentation resolution itself is independently covered by the service tests.
        servedPng = await renderTopicV2Poster({ ...frozenAttempt.resultSnapshot, imageUrl: currentResult?.imageUrl, poster: program.test.poster }, activity.id)
        res.setHeader('Content-Type', 'image/png'); res.end(servedPng); return
      }
      if (url.pathname.startsWith('/api/')) return send({ message: 'Unexpected local fixture request' }, 400)
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
    } catch (error) { send({ message: error instanceof Error ? error.message : 'fixture failure' }, 500) }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  async function goToTestStep(page: Page) {
    await page.getByLabel('活动名称', { exact: true }).waitFor()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [], 'untouched legacy activity fields do not trigger create-only validation')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [], 'untouched legacy participation rule does not block presentation edits')
    await page.getByLabel('测试标题', { exact: true }).waitFor()
  }
  async function save(page: Page) {
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.getByRole('button', { name: '确认保存修改', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '修改已保存并回读确认' }).waitFor()
  }
  try {
    assert.equal((await fetch(base)).status, 200, 'local HTTP probe passes before launching Chromium')
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1280, 390]) await t.test(`published legacy edit/upload/readback/PNG ${width}px`, async () => {
      program = structuredClone(initialProgram)
      const context = await browser!.newContext({ viewport: { width, height: 900 } })
      await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, (route) => route.abort())
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(base)
      await goToTestStep(page)
      await page.getByRole('group', { name: '结果 2 图片' }).getByLabel('结果海报图上传文件').setInputFiles({ name: 'result-background.png', mimeType: 'image/png', buffer: background })
      await page.getByText('上传成功', { exact: true }).waitFor()
      await page.getByText('分享海报设置', { exact: true }).click()
      await page.getByLabel('预览测试结果', { exact: true }).selectOption('result-two')
      const preview = page.getByRole('region', { name: '结果海报布局预览' })
      const bg = preview.getByAltText('结果海报背景预览')
      await bg.waitFor()
      assert.equal(await bg.getAttribute('src'), uploadedPath)
      await bg.evaluate((element) => (element as HTMLImageElement).decode())
      assert.equal(await bg.evaluate((element) => (element as HTMLImageElement).naturalWidth), 1080)
      const layoutImage = preview.getByAltText('结果海报布局预览')
      await layoutImage.evaluate((element) => (element as HTMLImageElement).decode())
      const svg = decodeURIComponent((await layoutImage.getAttribute('src'))!.split(',').slice(1).join(','))
      assert.doesNotMatch(svg, /<rect[^>]*width="1080"[^>]*fill="#102c48"/, 'overlay contains no opaque full-canvas fallback')
      // Inspect the browser's composed CSS image, not merely separate image sources.
      const canvasScreenshot = await bg.locator('..').screenshot()
      const { width: canvasWidth, height: canvasHeight } = await sharp(canvasScreenshot).metadata()
      assert.ok(canvasWidth && canvasHeight)
      const heroPixel = await sharp(canvasScreenshot).extract({ left: Math.floor(canvasWidth / 2), top: Math.floor(canvasHeight / 10), width: 1, height: 1 }).removeAlpha().raw().toBuffer()
      assert.deepEqual([...heroPixel], [59, 211, 139], 'actual browser poster hero shows uploaded green background, never opaque blue')
      await page.getByLabel('显示昵称', { exact: true }).uncheck()
      await page.getByLabel('显示活动二维码', { exact: true }).uncheck()
      const privateSource = decodeURIComponent((await preview.getByAltText('结果海报布局预览').getAttribute('src'))!.split(',').slice(1).join(','))
      assert.doesNotMatch(privateSource, /示例昵称/)
      assert.equal(await preview.getByAltText('活动二维码预览').count(), 0)
      assert.equal(await preview.getByAltText('ECFC 标志').count(), 0)
      const before = writes
      await save(page)
      assert.equal(writes, before + 1)
      assert.equal(program.test.results[1].imageUrl, uploadedPath)
      assert.equal(program.test.version, 7, 'image-only presentation save needs no scoring version bump')
      assert.deepEqual(program.test.questions, questionsBefore)
      assert.equal(program.test.poster.showNickname, false); assert.equal(program.test.poster.showQrCode, false)
      await page.reload(); await goToTestStep(page)
      await page.getByText('分享海报设置', { exact: true }).click()
      await page.getByLabel('预览测试结果', { exact: true }).selectOption('result-two')
      assert.equal(await page.getByLabel('显示昵称', { exact: true }).isChecked(), false)
      assert.equal(await page.getByLabel('显示活动二维码', { exact: true }).isChecked(), false)
      assert.equal(await page.getByAltText('结果海报背景预览').getAttribute('src'), uploadedPath)
      // Result descriptions belong to the protected test structure; only presentation preferences change.
      await page.getByLabel('显示昵称', { exact: true }).check()
      await save(page)
      assert.equal(writes, before + 2, 'reload and a second presentation save succeeds')
      assert.equal(program.test.results[1].imageUrl, uploadedPath)
      assert.equal(program.test.poster.showNickname, true); assert.equal(program.test.poster.showQrCode, false)
      assert.deepEqual(frozenAttempt, frozenBefore, 'historical attempt remains unchanged')

      await page.goto(`${base}/?runner=1&attemptId=historical-attempt`)
      await page.getByRole('heading', { name: '结果二', exact: true }).waitFor()
      const beforePoster = posterRequests
      await page.getByRole('button', { name: '生成结果海报', exact: true }).click()
      const image = page.getByAltText('我的测试结果海报')
      await image.waitFor(); await image.evaluate((element) => (element as HTMLImageElement).decode())
      const bytes = await image.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())))
      assert.deepEqual(Buffer.from(bytes), servedPng)
      const hero = await sharp(servedPng).extract({ left: 0, top: 0, width: 1080, height: 620 }).raw().toBuffer()
      const expected = await sharp(background).extract({ left: 0, top: 0, width: 1080, height: 620 }).raw().toBuffer()
      assert.deepEqual(hero, expected, 'uploaded 9:16 background survives the actual PNG overlay byte-for-byte')
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('link', { name: '保存 PNG', exact: true }).click()
      assert.deepEqual(readFileSync((await (await downloadPromise).path())!), servedPng)
      // Browser share contract only, not an iPhone/WeChat native share-sheet claim.
      await page.evaluate(`Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{document.documentElement.dataset.sharedBytes=JSON.stringify(Array.from(new Uint8Array(await files[0].arrayBuffer())))}})`)
      await page.getByRole('button', { name: '分享结果图片', exact: true }).click()
      await page.waitForFunction(() => Boolean(document.documentElement.dataset.sharedBytes))
      const shared = await page.evaluate(() => document.documentElement.dataset.sharedBytes!)
      assert.deepEqual(Buffer.from(JSON.parse(shared)), servedPng)
      assert.equal(posterRequests, beforePoster + 1)
      assert.ok(requests.every((request) => !/^POST \/api\/admin\/activities$|reward|draw|winner|shipment/.test(request)))
      assert.deepEqual(errors, [])
      assert.equal(activity.startsAt, null); assert.equal(activity.endsAt, null); assert.equal(activity.participationRule, null)
      await context.close()
    })
  } finally {
    await browser?.close(); server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    envNames.forEach((name, index) => { if (oldEnv[index] === undefined) delete process.env[name]; else process.env[name] = oldEnv[index] })
  }
})
