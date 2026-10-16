import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { serializeActivity } from '@/lib/activity'
import { createDefaultTopicActivityV2Program } from '@/lib/topic-activity-v2-config'

// Actual React components, local HTTP DTOs/storage only. No production traffic.
test('V3 actual platform dialogs, server state precedence and compact activity center work on desktop and mobile', {
  skip: process.env.TOPIC_V3_FRONTEND_BROWSER_QA !== '1', timeout: 120_000,
}, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> }
  const program = createDefaultTopicActivityV2Program()
  program.enabled = true; program.platformRewards.enabled = true
  program.poll.enabled = false; program.test.enabled = false; program.fixedReward.enabled = false; program.medal.enabled = false
  program.entries = ['Award', 'Approved', 'Pending', 'Rejected', 'New', 'NoRetry', 'Upload'].map((name, index) => ({
    id: name, platformKey: name.toLowerCase(), platformName: name + '平台', title: name + '分享任务', instructions: name + '真实任务说明',
    materialRequirement: '', minImages: name === 'Upload' ? 1 : 0, maxImages: name === 'Upload' ? 1 : 0, points: 99, enabled: true, sortOrder: index, startsAt: null, endsAt: null, allowResubmit: name !== 'NoRetry',
  }))
  const activities = ['进行中活动', '下期活动', '历史活动'].map((title, index) => serializeActivity({
    id: String(index), title, subtitle: '一句话说明', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', description: '此完整说明不应在列表展开', coverUrl: '/images/portrait.svg',
    startsAt: index === 1 ? '2099-01-01' : '2020-01-01', endsAt: index === 2 ? '2020-02-01' : '2100-01-01', createdAt: '2020-01-01', updatedAt: '2020-01-01',
  }))
  const extraRatios = [[4, 5], [1, 1], [9, 16], [16, 9]]
  for (const [width, height] of extraRatios) activities.push({ ...activities[0], id: `ratio-${width}-${height}`, title: `${width}:${height}封面活动`, coverUrl: `/images/ratio-${width}-${height}.svg` })
  let submissions = [
    { rewardEntryId: 'Award', status: 'REJECTED', commentId: 'award-comment' },
    { rewardEntryId: 'Approved', status: 'REJECTED', commentId: 'bad-latest' },
    { rewardEntryId: 'Approved', status: 'APPROVED', commentId: 'approved-comment' },
    { rewardEntryId: 'Pending', status: 'PENDING', commentId: 'pending-comment' },
    { rewardEntryId: 'Rejected', status: 'REJECTED', commentId: 'rejected-comment', rejectReason: '截图缺失' },
    { rewardEntryId: 'NoRetry', status: 'REJECTED', commentId: 'locked-comment' },
  ]
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TopicActivityV2Panel} from './components/activities/TopicActivityV2Panel';import {ActivitiesListClient} from './components/activities/ActivitiesListClient';createRoot(document.getElementById('root')).render(location.search.includes('center')?<ActivitiesListClient initialActivities={${JSON.stringify(activities)}} isAuthenticated={true} canCheckIn={true}/>:<TopicActivityV2Panel activityId="fixture" isAuthenticated={true} showComments={false}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, nodePaths: require.resolve.paths('react') ?? [],
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '""' },
    plugins: [{ name: 'local-next', setup(build: {
      onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }) => void
      onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void
    }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)};export function useRouter(){return {refresh(){},push(){}}};export function usePathname(){return '/activities'};export function useSearchParams(){return new URLSearchParams(location.search)}`, loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const css = (await require('postcss')([require('tailwindcss')({ content: ['./components/activities/*.tsx', './components/ConfirmDialog.tsx'] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css as string
  const writes: string[] = [], failures: string[] = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (body: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
    if (url.pathname === '/bundle.js') { res.end(bundle.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname === '/images/portrait.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="red"/></svg>'); return }
    const ratioImage = url.pathname.match(/^\/images\/ratio-(\d+)-(\d+)\.svg$/u)
    if (ratioImage) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${Number(ratioImage[1]) * 100}" height="${Number(ratioImage[2]) * 100}"><rect width="100%" height="100%" fill="green"/></svg>`); return }
    if (url.pathname === '/api/activities/me/topic-participations') {
      await new Promise((resolve) => setTimeout(resolve, 180))
      send({ participations: [{ activity: activities[0], status: 'APPROVED', submissionCount: 1, approvedSubmissionCount: 1, rewardStatus: 'GRANTED', countedInActivity: true }] }); return
    }
    if (url.pathname === '/api/uploads/topic-activity-image' && req.method === 'POST') {
      for await (const chunk of req) void chunk
      await new Promise((resolve) => setTimeout(resolve, 400))
      res.statusCode = 502; send({ message: '本地上传失败' }); return
    }
    if (url.pathname === '/api/activities/fixture/v2') {
      send({ program, entries: program.entries, activity: { status: 'PUBLISHED', startsAt: null, endsAt: null, allowImageAttachments: true, activityPostId: 'post' },
        myProgress: { submissions, grants: [{ rewardEntryId: 'Award', status: 'GRANTED', kind: 'POINTS', points: 7 }], submittedCount: 5, approvedCount: 2, totalGrantedPoints: 7, fixedGrantedPoints: 0, platformGrantedPoints: 7, remainingPlatformCount: null, medal: null } }); return
    }
    if (url.pathname === '/api/activities/fixture/v2/tasks' && req.method === 'POST') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString())
      writes.push(input.rewardEntryId)
      if (!['Rejected', 'New'].includes(input.rewardEntryId)) { failures.push('forbidden task write'); res.statusCode = 400; send({ message: '禁止重复提交' }); return }
      await new Promise((resolve) => setTimeout(resolve, 180))
      submissions = [{ rewardEntryId: input.rewardEntryId, status: 'PENDING', commentId: 'new-comment' }, ...submissions]
      send({ ok: true }); return
    }
    if (url.pathname.startsWith('/api/')) { failures.push(req.method + ' ' + url.pathname); res.statusCode = 404; send({}); return }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--surface:white;--surface-subtle:#eee;--border:#aaa;--foreground:#111;--foreground-muted:#555;--primary:blue}body{margin:0;padding:12px}</style><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  assert.equal((await fetch(origin)).status, 200)
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const browser = await chromium.launch({ headless: true, executablePath: existsSync(edge) ? edge : undefined, args: ['--disable-gpu'] }).catch(async (error) => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw error
  })
  try {
    for (const width of [1280, 390]) await t.test(String(width) + 'px actual platform state/modal and activity list', async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort())
      const page = await context.newPage()
      const browserErrors: string[] = []; page.on('pageerror', (error) => browserErrors.push(error.message))
      try {
        await page.goto(origin)
        const award = page.getByRole('button', { name: 'Award平台 已获得 7 挂号费' })
        await award.waitFor()
        assert.equal(await page.getByText('Award真实任务说明', { exact: true }).count(), 0, 'task instructions must stay collapsed by default')
        await award.click()
        const dialog = page.locator('dialog[open]')
        await dialog.waitFor()
        assert.equal(await dialog.getByRole('button', { name: /提交审核|重新提交/ }).count(), 0)
        assert.equal(await dialog.getByRole('status').textContent(), '已获得 7 挂号费')
        assert.match(await dialog.getByRole('link', { name: '查看提交' }).getAttribute('href') || '', /focus=award-comment#reply-award-comment$/u)
        for (let index = 0; index < 5; index++) {
          await page.keyboard.press('Tab')
          assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))), true)
        }
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await award.evaluate((element) => element === document.activeElement), true, 'Escape restores trigger focus')
        for (const name of ['Approved平台 已通过', 'Pending平台 待审核', 'NoRetry平台 未通过']) {
          await page.getByRole('button', { name }).click()
          assert.equal(await page.locator('dialog[open]').getByRole('button', { name: /提交审核|重新提交/ }).count(), 0)
          await page.keyboard.press('Escape')
        }
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('topic-activity-v2-open-task', { detail: { activityId: 'fixture', rewardEntryId: 'Award' } })))
        await page.waitForFunction(() => !document.querySelector('button[disabled]'))
        assert.equal(await page.locator('dialog[open]').count(), 0, 'external navigation event cannot bypass a grant')
        if (width === 1280) {
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('topic-activity-v2-open-task', { detail: { activityId: 'fixture', rewardEntryId: 'Rejected' } })))
          await dialog.waitFor()
          assert.equal(await dialog.getByText('拒绝原因：截图缺失').count(), 1)
          await dialog.getByRole('button', { name: '重新提交待审核' }).click()
          await dialog.getByRole('button', { name: '确认提交', exact: true }).click()
          await page.keyboard.press('Escape')
          assert.equal(await page.locator('dialog[open]').count(), 1, 'pending request cannot close the modal')
          await page.getByRole('button', { name: 'Rejected平台 待审核' }).waitFor()
        }
        await page.getByRole('button', { name: 'Upload平台 尚未提交' }).click()
        await dialog.getByRole('textbox', { name: '备注' }).fill('上传失败后保留备注')
        await Promise.all([
          page.waitForRequest((request) => request.url().endsWith('/api/uploads/topic-activity-image')),
          dialog.locator('input[type="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQZ0AAAAASUVORK5CYII=', 'base64') }),
        ])
        assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true)
        await page.keyboard.press('Escape')
        assert.equal(await dialog.count(), 1, 'uploading cannot close or discard input')
        await dialog.getByRole('alert').filter({ hasText: '本地上传失败' }).waitFor()
        assert.equal(await dialog.getByRole('textbox', { name: '备注' }).inputValue(), '上传失败后保留备注')
        await dialog.getByRole('button', { name: '关闭', exact: true }).click()
        await page.goto(origin + '?center')
        await page.getByRole('link', { name: '扫码核销' }).waitFor()
        const card = page.getByRole('link').filter({ has: page.getByRole('heading', { name: '进行中活动', exact: true }) })
        await card.waitFor()
        const image = card.getByRole('img')
        await image.evaluate((element) => (element as HTMLImageElement).decode())
        const layout = await image.evaluate((element) => ({ width: element.getBoundingClientRect().width, fit: getComputedStyle(element).objectFit, naturalWidth: (element as HTMLImageElement).naturalWidth, naturalHeight: (element as HTMLImageElement).naturalHeight }))
        assert.equal(layout.fit, 'contain'); assert.equal(layout.naturalWidth / layout.naturalHeight, 3 / 4)
        assert.ok(layout.width >= (width < 640 ? 100 : 140) && layout.width <= (width < 640 ? 130 : 180))
        assert.ok((await card.boundingBox())!.height < 260, 'horizontal card must remain compact')
        for (const [imageWidth, imageHeight] of extraRatios) {
          const ratioCard = page.getByRole('link').filter({ has: page.getByRole('heading', { name: `${imageWidth}:${imageHeight}封面活动`, exact: true }) })
          await ratioCard.scrollIntoViewIfNeeded()
          const ratioImage = ratioCard.getByRole('img')
          await ratioImage.evaluate((element) => (element as HTMLImageElement).decode())
          const ratio = await ratioImage.evaluate((element) => ({ ratio: (element as HTMLImageElement).naturalWidth / (element as HTMLImageElement).naturalHeight, fit: getComputedStyle(element).objectFit }))
          assert.equal(ratio.ratio, imageWidth / imageHeight); assert.equal(ratio.fit, 'contain')
        }
        await page.getByRole('button', { name: '即将开始', exact: true }).click()
        await page.getByRole('heading', { name: '下期活动' }).waitFor()
        assert.equal(await page.getByRole('heading', { name: '进行中活动' }).count(), 0)
        await page.getByRole('button', { name: '已结束', exact: true }).click()
        await page.getByRole('heading', { name: '历史活动' }).waitFor()
        await page.getByRole('tab', { name: '我的参与' }).click()
        await page.getByText('参与评论 1 条 · 通过 1 条 · 已计入 1 次活动参与').waitFor()
        assert.equal(await page.getByText('正在加载我的参与…').count(), 0, 'mine loading must settle after its own state update')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.deepEqual(browserErrors, [])
      } finally { await context.close() }
    })
    assert.deepEqual(writes, ['Rejected']); assert.deepEqual(failures, [])
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})
