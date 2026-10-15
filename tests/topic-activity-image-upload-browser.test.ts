import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { chromium, type Locator, type Page } from 'playwright'
import { fixture, instant } from './fixtures/topic-v2-transaction'
import { publicTopicActivityV2Program, readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { defaultTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'

// Local transport/storage doubles only. The admin manager, both editors, test
// submission snapshot, PNG renderer and user preview/download/share are real.
test('actual admin image uploads persist, refresh and render independently into the same user PNG', {
  skip: process.env.TOPIC_IMAGE_BROWSER_QA !== '1', timeout: 240_000,
}, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const objects = new Map<string, Buffer>()
  const reads: string[] = []
  const moduleLoader = require('node:module') as { _load: (name: string, parent: unknown, main: boolean) => unknown }
  const load = moduleLoader._load
  moduleLoader._load = function (name, parent, main) {
    if (name.includes('tencent-cos')) return { getCosObject: async (key: string) => {
      reads.push(key)
      const bytes = objects.get(key)
      assert.ok(bytes, 'renderer must read an uploaded controlled object: ' + key)
      return bytes
    } }
    return load.call(this, name, parent, main)
  }
  let render: typeof import('@/lib/topic-activity-v2-poster').renderTopicV2Poster
  try { render = (require(join(process.cwd(), 'lib/topic-activity-v2-poster.ts')) as typeof import('@/lib/topic-activity-v2-poster')).renderTopicV2Poster }
  finally { moduleLoader._load = load }

  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }>
  }
  const f = fixture()
  for (const entry of f.program.entries) { entry.minImages = 1; entry.maxImages = 3 }
  f.program.test.title = '真实图片测试'
  f.program.test.results[0] = { ...f.program.test.results[0], title: '结果一', description: '红色结果图' }
  f.program.test.results[1] = { ...f.program.test.results[1], title: '结果二', description: '绿色结果图' }
  f.program.test.poster.showQrCode = true
  const oldKey = 'activities/11111111-1111-4111-8111-111111111111/source.webp'
  objects.set(oldKey, await sharp({ create: { width: 100, height: 180, channels: 4, background: '#42315c' } }).webp().toBuffer())
  f.program.test.results[0].imageUrl = '/cos/' + oldKey
  f.program.test.poster.backgroundUrl = '/cos/' + oldKey
  assert.ok(readTopicActivityV2Program(f.program), 'local browser fixture must satisfy the existing program contract')
  const artifacts = process.env.TOPIC_IMAGE_QA_ARTIFACTS
  if (artifacts) await mkdir(artifacts, { recursive: true })
  const activity = { ...f.activity, subtitle: null, displayStatus: 'ONGOING', coverUrl: null, bannerUrl: null, registrationFee: 0,
    description: '仅本地活动', participationRule: '完成测试参与', participationMode: 'COMMENT', allowImageAttachments: true,
    rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null, rewardPoints: null, rewardBadgeCount: 0, rewardBadgeIds: [],
    signupLimit: null, signupCount: 0, sortOrder: 0, viewCount: 0, verificationMode: 'NONE', linkedMaterial: null,
    startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z', createdAt: instant.toISOString(), updatedAt: instant.toISOString() }
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ActivityAdminManager} from './app/admin/activities/ActivityAdminManager'; import {TopicActivityV2TestRunner} from './components/activities/TopicActivityV2Interactive'; const mode=new URLSearchParams(location.search).get('mode'); createRoot(document.getElementById('root')).render(mode==='test'?<TopicActivityV2TestRunner activityId="activity-one" isAuthenticated={true}/>:<ActivityAdminManager initialActivities={[${JSON.stringify(activity)}]}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, nodePaths: require.resolve.paths('react') ?? [], define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '""' },
    plugins: [{ name: 'next-local-fixture', setup(build: {
      onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }) => void
      onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void
    }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)};export function useRouter(){return {refresh(){},push(){}}};export function usePathname(){return '/admin/activities'};export function useSearchParams(){return new URLSearchParams(location.search)}`, loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const css = (await require('postcss')([require('tailwindcss')({ content: ['./components/activities/*.tsx', './app/admin/activities/*.tsx', './components/ConfirmDialog.tsx'] })])
    .process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css as string
  const calls: string[] = [], failures: string[] = []
  let uploadCount = 0, failUpload = false, configWrites = 0
  const output = new Map<string, Buffer>()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    const read = async () => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks) }
    if (url.pathname.startsWith('/api/')) calls.push(req.method + ' ' + url.pathname)
    try {
      if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return }
      if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
      if (url.pathname.startsWith('/cos/activities/')) {
        const key = url.pathname.slice('/cos/'.length).replace(/\/(?:card|thumb|large)\.webp$/u, '/source.webp')
        const image = objects.get(key); assert.ok(image, 'preview must use local stored bytes')
        res.setHeader('Content-Type', 'image/webp'); res.end(image); return
      }
      if (url.pathname === '/api/uploads/activity-image' && req.method === 'POST') {
        assert.match(req.headers['content-type'] || '', /^multipart\/form-data; boundary=/u)
        const bytes = await read()
        const form = await new Request('http://local.invalid/upload', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: bytes }).formData()
        const file = form.get('file'); assert.ok(file instanceof File)
        const uploaded = Buffer.from(await file.arrayBuffer()); assert.equal((await sharp(uploaded).metadata()).format, 'png')
        if (failUpload) return send({ message: '本地上传失败' }, 502)
        uploadCount++
        const id = String(uploadCount + 10).padStart(8, '0') + '-2222-4222-8222-222222222222'
        const key = 'activities/' + id + '/source.webp'
        objects.set(key, await sharp(uploaded).webp({ lossless: true }).toBuffer())
        return send({ url: '/cos/' + key })
      }
      if (url.pathname === '/api/admin/activities/activity-one/v2') {
        if (req.method === 'PATCH') {
          const input = JSON.parse((await read()).toString()); assert.deepEqual(Object.keys(input), ['program'])
          assert.doesNotMatch(JSON.stringify(input), /blob:|file:\/\/|localhost|[A-Z]:\\/u)
          Object.assign(f.program, input.program); configWrites++; return send({ program: f.program })
        }
        return send({ activity, program: f.program, statistics: { testParticipants: 0, pollResults: [], entries: [], platforms: [] } })
      }
      if (url.pathname === '/api/admin/activities/activity-one') { assert.equal(req.method, 'GET'); return send({ activity }) }
      if (url.pathname.endsWith('/v2/lottery')) return send({ config: defaultTopicLotteryConfig(), configLocked: false, addressEncryptionReady: true, state: 'DISABLED', candidateCount: 0, pendingSubmissionCount: 0, draw: null, winners: [], canShip: false })
      if (url.pathname.endsWith('/badges')) return send({ badges: [] })
      if (url.pathname.endsWith('/materials')) return send({ materials: [] })
      if (url.pathname.endsWith('/v2/fixed-reward')) return send({ claims: [] })
      if (url.pathname.endsWith('/v2/test')) {
        if (req.method === 'POST') {
          const input = JSON.parse((await read()).toString())
          assert.deepEqual(Object.keys(input).sort(), ['answers', 'requestKey'])
          const result = await f.run(() => submitTopicV2Test({ activityId: activity.id, userId: 'user-one', answers: input.answers, requestKey: input.requestKey, now: instant }))
          return send(result)
        }
        return send({ activity: { title: activity.title }, test: publicTopicActivityV2Program(f.program).test })
      }
      if (url.pathname.endsWith('/v2/attempts')) return send({ attempts: f.state.attempts })
      const poster = url.pathname.match(/\/v2\/attempts\/([^/]+)\/poster$/u)
      if (poster) {
        const attempt = f.state.attempts.find((row: { id: string }) => row.id === poster[1]); assert.ok(attempt)
        const bytes = await render(attempt.resultSnapshot, activity.id); output.set(attempt.id, bytes)
        res.setHeader('Content-Type', 'image/png'); res.end(bytes); return
      }
      if (url.pathname.startsWith('/api/')) return send({ message: 'unexpected local fixture route' }, 404)
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
    } catch (error) { failures.push(String(error)); send({ message: String(error) }, 500) }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  assert.equal((await fetch(origin)).status, 200)
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const red = await sharp({ create: { width: 240, height: 160, channels: 4, background: '#f12436' } }).png().toBuffer()
  const green = await sharp({ create: { width: 160, height: 240, channels: 4, background: '#22dc58' } }).png().toBuffer()
  const yellow = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#eebf20' } }).png().toBuffer()
  async function upload(input: Locator, bytes: Buffer, scope: Locator, name: string) {
    const response = input.page().waitForResponse((response) => response.url().endsWith('/api/uploads/activity-image') && response.request().method() === 'POST')
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: bytes })
    assert.ok((await response).ok())
    await scope.getByRole('status').filter({ hasText: '上传成功' }).waitFor()
    await scope.locator('img').evaluate((image) => (image as HTMLImageElement).decode())
    assert.ok(await scope.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth > 0))
  }
  async function openAdvanced(page: Page) {
    await page.goto(origin + '/admin/activities')
    await page.getByRole('button', { name: '高级设置', exact: true }).click()
    await page.getByRole('button', { name: '互动与平台奖励配置', exact: true }).click()
    await page.getByLabel('测试标题', { exact: true }).waitFor()
    await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((input) => input.value === '真实图片测试'))
    assert.equal(await page.getByText('结果图片地址（可选）', { exact: true }).count(), 0)
    assert.equal(await page.getByText('背景图片公开路径', { exact: true }).count(), 0)
  }
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1280, 390]) await t.test('actual admin path and PNG chain at ' + width + 'px', async () => {
      const context = await browser!.newContext({ viewport: { width, height: 900 } })
      const errors: string[] = []
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin === origin) return route.continue()
        if (url.origin === 'https://media.ecfc.fans' && url.pathname.startsWith('/media/activities/')) {
          const key = url.pathname.slice('/media/'.length).replace(/\/(?:card|thumb|large)\.webp$/u, '/source.webp')
          const bytes = objects.get(key)
          if (bytes) return route.fulfill({ contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' }, body: bytes })
        }
        return route.abort()
      })
      const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message))
      page.setDefaultTimeout(12_000)
      try {
      await openAdvanced(page)
      const result1 = page.getByRole('group', { name: '结果 1', exact: true })
      const result2 = page.getByRole('group', { name: '结果 2', exact: true })
      const background = page.getByRole('group', { name: '结果海报', exact: true })
      const oldResult = await result1.getByAltText('结果图片预览').getAttribute('src')
      const oldBackground = await background.getByAltText('结果海报背景图预览').getAttribute('src')
      await result1.getByAltText('结果图片预览').evaluate((image) => (image as HTMLImageElement).decode())
      await background.getByAltText('结果海报背景图预览').evaluate((image) => (image as HTMLImageElement).decode())
      failUpload = true
      await result1.getByLabel('结果图片上传文件').setInputFiles({ name: 'fail.png', mimeType: 'image/png', buffer: red })
      await result1.getByRole('alert').filter({ hasText: '未替换当前结果图片' }).waitFor()
      assert.equal(await result1.getByAltText('结果图片预览').getAttribute('src'), oldResult)
      await background.getByLabel('结果海报背景图上传文件').setInputFiles({ name: 'fail.png', mimeType: 'image/png', buffer: yellow })
      await background.getByRole('alert').filter({ hasText: '未替换当前背景图' }).waitFor()
      assert.equal(await background.getByAltText('结果海报背景图预览').getAttribute('src'), oldBackground)
      failUpload = false
      await upload(result1.getByLabel('结果图片上传文件'), red, result1, 'result-one.png')
      await upload(result2.getByLabel('结果图片上传文件'), green, result2, 'result-two.png')
      await upload(background.getByLabel('结果海报背景图上传文件'), yellow, background, 'background.png')
      assert.equal(await result1.getByRole('button', { name: '替换图片', exact: true }).count(), 1)
      await result1.getByRole('button', { name: '移除图片', exact: true }).click()
      assert.equal(await result1.getByAltText('结果图片预览').count(), 0)
      assert.ok(await result1.getByRole('button', { name: '上传图片', exact: true }).isVisible())
      await upload(result1.getByLabel('结果图片上传文件'), red, result1, 'result-one-replaced.png')
      await background.getByRole('button', { name: '移除背景', exact: true }).click()
      assert.equal(await background.getByAltText('结果海报背景图预览').count(), 0)
      assert.ok(await background.getByRole('button', { name: '上传背景图', exact: true }).isVisible())
      await upload(background.getByLabel('结果海报背景图上传文件'), yellow, background, 'background-replaced.png')
      await page.getByLabel('显示昵称', { exact: true }).check()
      await page.getByLabel('显示活动二维码', { exact: true }).check()
      const beforeWrite = configWrites
      await page.getByRole('button', { name: '保存活动模块配置', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '活动模块配置已保存并回读确认' }).waitFor()
      if (artifacts) {
        await page.screenshot({ path: join(artifacts, `admin-advanced-${width}.png`) })
        await result1.screenshot({ path: join(artifacts, `admin-result-image-${width}.png`) })
        await background.screenshot({ path: join(artifacts, `admin-background-${width}.png`) })
      }
      assert.equal(configWrites, beforeWrite + 1)
      assert.equal(calls.at(-1), 'GET /api/admin/activities/activity-one/v2')
      const savedImages = f.program.test.results.map((row) => row.imageUrl)
      let savedBackground = f.program.test.poster.backgroundUrl
      assert.notEqual(savedImages[0], savedImages[1]); assert.notEqual(savedImages[0], savedBackground)
      await openAdvanced(page)
      assert.match(await result1.getByAltText('结果图片预览').getAttribute('src') || '', new RegExp(savedImages[0]!.split('/')[3]))
      assert.match(await result2.getByAltText('结果图片预览').getAttribute('src') || '', new RegExp(savedImages[1]!.split('/')[3]))
      assert.match(await background.getByAltText('结果海报背景图预览').getAttribute('src') || '', new RegExp(savedBackground!.split('/')[3]))
      await result1.getByAltText('结果图片预览').evaluate((image) => (image as HTMLImageElement).decode())
      await result2.getByAltText('结果图片预览').evaluate((image) => (image as HTMLImageElement).decode())
      await background.getByAltText('结果海报背景图预览').evaluate((image) => (image as HTMLImageElement).decode())

      // Exercise the second real entry: ActivityAdminManager -> simple EDIT.
      await page.goto(origin + '/admin/activities')
      await page.getByRole('button', { name: '编辑', exact: true }).click()
      await page.getByRole('region', { name: '话题活动编辑向导' }).waitFor()
      await page.getByLabel('活动名称', { exact: true }).waitFor()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      const wizardResult = page.getByRole('group', { name: '结果 2 图片', exact: true })
      await wizardResult.getByAltText('结果图片预览').waitFor()
      assert.equal(await page.getByText('结果图片地址（可选）', { exact: true }).count(), 0)
      assert.equal(await page.getByText('背景图片公开路径', { exact: true }).count(), 0)
      await upload(wizardResult.getByLabel('结果图片上传文件'), green, wizardResult, 'wizard-result-two.png')
      await page.getByText('高级结果海报设置', { exact: true }).click()
      const wizardBackground = page.locator('details').filter({ has: page.getByText('高级结果海报设置', { exact: true }) })
      await wizardBackground.getByAltText('结果海报背景图预览').waitFor()
      assert.equal(await wizardBackground.getByRole('button', { name: '替换背景', exact: true }).count(), 1)
      await upload(wizardBackground.getByLabel('结果海报背景图上传文件'), yellow, wizardBackground, 'wizard-background.png')
      await page.getByRole('button', { name: '保存修改', exact: true }).click()
      await page.getByRole('button', { name: '确认保存修改', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '修改已保存并回读确认' }).waitFor()
      if (artifacts) {
        await wizardResult.screenshot({ path: join(artifacts, `admin-simple-result-${width}.png`) })
        await wizardBackground.screenshot({ path: join(artifacts, `admin-simple-background-${width}.png`) })
      }
      assert.equal(f.program.test.results[0].imageUrl, savedImages[0], 'wizard result2 must preserve result1')
      assert.notEqual(f.program.test.poster.backgroundUrl, savedBackground, 'the real simple editor must save its uploaded background too')
      savedBackground = f.program.test.poster.backgroundUrl

      // Two real user completions must use two independently persisted images.
      for (const [answer, resultTitle, color] of [['no', '结果一', 'red'], ['yes', '结果二', 'green']] as const) {
        await page.goto(origin + '/?mode=test')
        await page.getByRole('radio', { name: answer === 'yes' ? '正确' : '错误', exact: true }).check()
        await page.getByRole('button', { name: '提交测试', exact: true }).click()
        await page.getByRole('heading', { name: resultTitle, exact: true }).waitFor()
        await page.getByRole('button', { name: '生成结果海报', exact: true }).click()
        const preview = page.getByAltText('我的测试结果海报'); await preview.waitFor()
        await page.waitForFunction(() => (document.querySelector('img[alt="我的测试结果海报"]') as HTMLImageElement)?.naturalWidth === 1080)
        const attempt = f.state.attempts.at(-1), png = output.get(attempt.id)!; assert.ok(png)
        assert.deepEqual(await sharp(png).metadata().then(({ width, height }) => [width, height]), [1080, 1920])
        assert.ok(await preview.evaluate((image) => { const r = image.getBoundingClientRect(); return Math.abs(r.width / r.height - 9 / 16) < .01 }))
        const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)]
        const corner = pixel(20, 20); assert.ok(corner[0] > 200 && corner[1] > 150 && corner[2] < 70, 'actual uploaded yellow background appears in exported PNG')
        let redPixels = 0, greenPixels = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 200 && data[i + 1] < 90 && data[i + 2] < 110) redPixels++
          if (data[i] < 90 && data[i + 1] > 170 && data[i + 2] < 130) greenPixels++
        }
        assert.ok((color === 'red' ? redPixels : greenPixels) > 10_000, 'matched result image must occupy real PNG pixels')
        assert.equal(color === 'red' ? greenPixels : redPixels, 0, 'other result image must not leak into this result')
        const { data: luminance, info: qrInfo } = await sharp(png).extract({ left: 720, top: 1530, width: 280, height: 280 }).grayscale().raw().toBuffer({ resolveWithObject: true })
        const zxing = require('@zxing/library') as {
          RGBLuminanceSource: new (bytes: Uint8ClampedArray, width: number, height: number) => unknown
          HybridBinarizer: new (source: unknown) => unknown
          BinaryBitmap: new (source: unknown) => unknown
          QRCodeReader: new () => { decode(bitmap: unknown): { getText(): string } }
        }
        assert.equal(new zxing.QRCodeReader().decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(new Uint8ClampedArray(luminance), qrInfo.width, qrInfo.height)))).getText(), 'https://ecfc.fans/activities/activity-one')
        const previewBytes = Buffer.from(await preview.evaluate(async (image) => Array.from(new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer()))))
        assert.deepEqual(previewBytes, png)
        if (artifacts) {
          await writeFile(join(artifacts, `result-${color}-${width}.png`), png)
          await page.screenshot({ path: join(artifacts, `user-${color}-${width}.png`) })
        }
        const downloading = page.waitForEvent('download'); await page.getByRole('link', { name: '保存 PNG' }).click()
        assert.deepEqual(readFileSync((await (await downloading).path())!), png)
        await page.evaluate(`
          Object.defineProperty(navigator, 'canShare', { configurable: true, value: function () { return true } })
          Object.defineProperty(navigator, 'share', { configurable: true, value: async function ({ files }) {
            const bytes = new Uint8Array(await files[0].arrayBuffer())
            let binary = ''
            for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
            document.documentElement.dataset.shared = btoa(binary)
          } })
        `)
        await page.getByRole('button', { name: '分享结果图片' }).click()
        await page.waitForFunction(() => Boolean(document.documentElement.dataset.shared))
        assert.deepEqual(Buffer.from(await page.evaluate(() => document.documentElement.dataset.shared!), 'base64'), png, 'share must reuse the exact preview/download PNG')
        assert.ok(reads.includes(attempt.resultSnapshot.imageUrl.slice('/cos/'.length)))
        assert.ok(reads.includes(savedBackground!.slice('/cos/'.length)))
      }
      const older = f.state.attempts.at(-2)
      const later = f.state.attempts.at(-1)
      let releasePoster!: () => void, posterRequested!: () => void
      const heldPoster = new Promise<void>((resolve) => { releasePoster = resolve })
      const requested = new Promise<void>((resolve) => { posterRequested = resolve })
      const delayedPath = '/api/activities/activity-one/v2/attempts/' + older.id + '/poster'
      await page.route('**' + delayedPath, async (route) => {
        posterRequested()
        await heldPoster
        await route.fulfill({ contentType: 'image/png', body: output.get(older.id)! })
      })
      try {
        await page.getByRole('button', { name: /^结果一 ·/ }).last().click()
        await page.getByRole('button', { name: '生成结果海报', exact: true }).click()
        await requested
        await page.getByRole('button', { name: /^结果二 ·/ }).last().click()
        releasePoster()
        await page.getByRole('button', { name: '生成结果海报', exact: true }).waitFor()
        assert.equal(await page.getByAltText('我的测试结果海报').count(), 0, 'a late old poster must not attach to a different selected result')
        assert.equal(await page.getByRole('heading', { name: later.resultSnapshot.title, exact: true }).count(), 1)
      } finally { releasePoster(); await page.unroute('**' + delayedPath) }
      assert.deepEqual(errors, []); assert.deepEqual(failures, [])
      assert.ok(calls.every((call) => !/\/draw|\/winners|\/shipment|\/address|\/reward/u.test(call)))
      assert.ok(calls.every((call) => !call.startsWith('DELETE ')), 'removing an image only edits form state')
      } catch (cause) {
        if (artifacts) await page.screenshot({ path: join(artifacts, `failure-${width}.png`) }).catch(() => undefined)
        const alerts = await page.getByRole('alert').allTextContents().catch(() => ['page unavailable'])
        const body = await page.locator('body').innerText().catch(() => 'page unavailable')
        throw new Error(`Browser chain failed at ${width}px; alerts=${JSON.stringify(alerts)}; calls=${calls.slice(-12).join('|')}; page=${body.slice(-3000)}; errors=${errors.join('|')}`, { cause })
      } finally { await context.close().catch(() => undefined) }
    })
  } finally {
    await browser?.close().catch(() => undefined); server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
