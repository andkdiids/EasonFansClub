import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { fixture } from './fixtures/topic-v2-transaction'
import { publicTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { calculateTopicV2Test } from '@/lib/topic-activity-v2-interactive'

test('V2 actual Web components: vote/test/PNG/review/admin editing at desktop and mobile widths', { skip: process.env.TOPIC_V2_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const resolveFromApp = createRequire(join(process.cwd(), 'package.json'))
  const reactPath = resolveFromApp.resolve('react')
  const jsxRuntimePath = resolveFromApp.resolve('react/jsx-runtime')
  const reactDomPath = resolveFromApp.resolve('react-dom')
  const reactDomClientPath = resolveFromApp.resolve('react-dom/client')
  const schedulerPath = createRequire(reactDomClientPath).resolve('scheduler')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const f = fixture()
  f.program.test.poster.backgroundUrl = '/uploads/old-poster.webp'
  f.program.test.results[0].imageUrl = '/uploads/legacy-result-one.webp'
  f.program.test.results[1].imageUrl = '/uploads/legacy-result-two.webp'
  f.program.test.questions.push({ id: 'q2', prompt: '第二题', points: 0, options: [{ id: 'a2', label: '第二题选项A' }, { id: 'b2', label: '第二题选项B' }], correctOptionId: 'a2' })
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityV2PollPanel,TopicActivityV2TestRunner} from './components/activities/TopicActivityV2Interactive'; import {TopicActivityV2TaskReview} from './components/activities/TopicActivityV2TaskReview'; import {TopicActivityV2Editor} from './components/activities/TopicActivityV2Editor'; import {TopicActivityV2Panel} from './components/activities/TopicActivityV2Panel'; const mode=new URLSearchParams(location.search).get('mode'); createRoot(document.getElementById('root')).render(mode==='panel'?<TopicActivityV2Panel activityId="activity-one" isAuthenticated={true} currentUserId="user-one"/>:mode==='test'?<TopicActivityV2TestRunner activityId="activity-one" isAuthenticated={true}/>:mode==='review'?<TopicActivityV2TaskReview activityId="activity-one" canReview={true} submission={{id:'submission-one',status:'PENDING',rewardEntryId:'weibo',rewardSnapshotSafe:{platformName:'微博',title:'分享任务',points:96,instructions:'提交截图'}}}/>:mode==='editor'?<TopicActivityV2Editor activityId="activity-one"/>:<TopicActivityV2PollPanel activityId="activity-one" isAuthenticated={true}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(),
    nodePaths: [join(process.cwd(), 'node_modules')],
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '"https://media.ecfc.fans/media"' },
    plugins: [{ name: 'normal-next-link-fixture', setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path?: string; namespace?: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string; namespace: string }) => { contents: string; loader: string; resolveDir: string }) => void }) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const base = join(process.cwd(), args.path.slice(2))
        const source = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js'].find((candidate) => existsSync(candidate))
        return { path: source || base }
      })
      build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: jsxRuntimePath }))
      build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
      build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: reactDomClientPath }))
      build.onResolve({ filter: /^scheduler$/ }, () => ({ path: schedulerPath }))
      build.onResolve({ filter: /^\.\// }, (args) => {
        const base = join(args.resolveDir, args.path)
        const source = [base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js'].find((candidate) => existsSync(candidate))
        return source ? { path: source } : {}
      })
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'navigation-fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }', loader: 'js', resolveDir: process.cwd() }))
      build.onLoad({ filter: /.*/, namespace: 'navigation-fixture' }, () => ({ contents: 'export function useRouter(){return {refresh(){},push(){}}} export function usePathname(){return "/fixture"} export function useSearchParams(){return new URLSearchParams(location.search)}', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const postcss = require('postcss'), tailwind = require('tailwindcss')
  const css = (await postcss([tailwind({ ...require('./tailwind.config.ts').default, content: [{ raw: build.outputFiles[0].text, extension: 'js' }] })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css
  let votes: string[] = [], voteWrites = 0, testWrites = 0, reviewWrites = 0, configWrites = 0, taskWrites = 0, uploadRequests = 0, uploadShouldFail = true
  const attempts: Array<Record<string, unknown>> = []
  let personality = false
  const programForTest = () => {
    const program = structuredClone(f.program)
    program.test.results[1].title = '服务端真实结果'
    if (personality) {
      program.test.mode = 'PERSONALITY'
      program.test.results = [{ id: 'first', title: '趣味测试结果', description: '偏好甲' }, { id: 'second', title: '另一种偏好', description: '偏好乙' }]
      program.test.questions = program.test.questions.map((question) => ({ ...question, correctOptionId: undefined,
        options: question.options.map((option, index) => ({ ...option, weights: { [index === 0 ? 'first' : 'second']: index === 0 ? 2 : 1 } })) }))
    }
    return program
  }
  const png = await renderTopicV2Poster({ title: '本地结果', description: '已完成测试', poster: { width: 360, height: 640 } }, 'activity-one')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
    const body = async () => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString()) }
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(build.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname === '/api/uploads/activity-image' && req.method === 'POST') { uploadRequests++; return uploadShouldFail ? send({ message: 'fixture upload failed' }, 502) : send({ url: 'https://media.ecfc.fans/media/activities/22222222-2222-4222-8222-222222222222/source.webp' }) }
    if (url.pathname === '/api/activities/activity-one/v2') return send({ program: publicTopicActivityV2Program(f.program), entries: f.program.entries,
      myProgress: { totalGrantedPoints: 0, platformGrantedPoints: 0, fixedGrantedPoints: 0, remainingPlatformCount: null, medal: null, submissions: [], grants: [], submittedCount: 0, approvedCount: 0,
        testAttempts: attempts.slice().reverse().map((item) => ({ id: item.id, testId: item.testId, configVersion: item.configVersion })) },
      activity: { status: 'PUBLISHED', startsAt: null, endsAt: null, activityPostId: null, allowImageAttachments: true } })
    if (url.pathname.endsWith('/v2/tasks') && req.method === 'POST') { const input = await body(); assert.equal(input.rewardEntryId, 'weibo'); taskWrites++; return send({ submission: { status: 'PENDING' } }, 201) }
    if (url.pathname.endsWith('/poster')) { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    if (url.pathname.endsWith('/v2/poll')) {
      if (req.method === 'POST') { votes = (await body()).choices; voteWrites++; return send({ changed: true }) }
      return send({ poll: f.program.poll, myChoices: votes, results: { participantCount: votes.length ? 1 : 0, options: [{ id: 'a', label: 'A', count: votes.length, percentage: votes.length ? 100 : 0 }] } })
    }
    if (url.pathname.endsWith('/v2/test')) {
      if (req.method === 'POST') {
        const input = await body(); assert.equal('score' in input, false); assert.equal('resultId' in input, false); assert.deepEqual(input.answers, { q1: 'yes', q2: 'a2' }); testWrites++
        const computed = calculateTopicV2Test(programForTest().test, input.answers)
        const attempt = { id: personality ? 'attempt-two' : 'attempt-one', testId: programForTest().test.id, configVersion: programForTest().test.version, resultSnapshot: { title: computed.result.title, description: computed.result.description,
          score: computed.score, maxScore: computed.maxScore, testTitle: personality ? '趣味测试' : '知识测试' }, completedAt: new Date().toISOString() }; attempts.push(attempt); return send({ attempt })
      }
      return send({ activity: { title: '本地活动' }, test: publicTopicActivityV2Program(programForTest()).test })
    }
    if (url.pathname.endsWith('/v2/attempts')) return send({ attempts })
    if (url.pathname.endsWith('/v2/submissions/submission-one')) {
      if (req.method === 'PATCH') { reviewWrites++; await body(); await new Promise((resolve) => setTimeout(resolve, 100)); return send({ message: '审核失败，页面保留' }, 500) }
      return send({ history: [{ id: 'log-one', fromStatus: 'PENDING', toStatus: 'REJECTED', reason: '本地原因', reviewedAt: new Date().toISOString(), ReviewedBy: { nickname: '测试管理员' } }] })
    }
    if (url.pathname.endsWith('/v2/fixed-reward')) return send({ claims: [] })
    if (url.pathname.endsWith('/activities/badges')) return send({ badges: [] })
    if (url.pathname === '/api/admin/activities/activity-one/v2') {
      if (req.method === 'PATCH') { const input = await body(); assert.equal(input.program.entries.length, 1); assert.equal(input.program.test.poster.backgroundUrl, '/cos/activities/22222222-2222-4222-8222-222222222222/source.webp'); assert.equal(input.program.test.results[0].imageUrl, '/uploads/legacy-result-one.webp'); assert.equal(input.program.test.results[1].imageUrl, '/uploads/legacy-result-two.webp'); Object.assign(f.program, input.program); configWrites++; return send({ program: f.program }) }
      return send({ program: f.program, activity: { activityPostId: 'post-one' }, statistics: { pollResults: [], entries: [], platforms: [] } })
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1024, 360, 390, 430]) {
      votes = []; voteWrites = 0; testWrites = 0; reviewWrites = 0; configWrites = 0; taskWrites = 0; uploadRequests = 0; uploadShouldFail = true; attempts.length = 0
      personality = false
      f.program.test.poster.backgroundUrl = '/uploads/old-poster.webp'
      f.program.test.results[0].imageUrl = '/uploads/legacy-result-one.webp'
      f.program.test.results[1].imageUrl = '/uploads/legacy-result-two.webp'
      const context = await browser.newContext({ viewport: { width, height: 844 }, ...(width < 500 ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 MicroMessenger/8.0' } : {}) })
      const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
      const open = (mode: string) => page.goto('http://127.0.0.1:' + port + '/?mode=' + mode)
      await open('poll'); await page.getByRole('radio', { name: 'A', exact: true }).check()
      await page.getByRole('button', { name: '确认投票', exact: true }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByText('你已投票。', { exact: false }).waitFor(); assert.equal(voteWrites, 1)
      await open('test'); await page.getByRole('radio', { name: '正确', exact: true }).check(); await page.getByRole('button', { name: '下一题' }).click()
      await page.getByRole('button', { name: '上一题' }).click(); assert.ok(await page.getByRole('radio', { name: '正确', exact: true }).isChecked())
      await page.getByRole('button', { name: '下一题' }).click(); await page.getByRole('radio', { name: '第二题选项A' }).check()
      await page.getByRole('button', { name: '提交测试' }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByRole('heading', { name: '服务端真实结果' }).waitFor(); assert.equal(testWrites, 1)
      await page.getByRole('button', { name: '生成结果海报' }).click(); await page.getByAltText('我的测试结果海报').waitFor()
      assert.ok(await page.getByAltText('我的测试结果海报').evaluate((element) => (element as HTMLImageElement).naturalWidth > 0))
      assert.deepEqual(await page.getByAltText('我的测试结果海报').evaluate((element) => [(element as HTMLImageElement).naturalWidth, (element as HTMLImageElement).naturalHeight]), [1080, 1440])
      const previewBytes = await page.getByAltText('我的测试结果海报').evaluate(async (element) => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())))
      assert.deepEqual(Buffer.from(previewBytes), png, 'preview uses the exact server PNG bytes')
      assert.ok(await page.getByAltText('我的测试结果海报').evaluate((element) => Math.abs((element as HTMLImageElement).getBoundingClientRect().width / (element as HTMLImageElement).getBoundingClientRect().height - 3 / 4) < 0.01))
      const downloadWait = page.waitForEvent('download'); await page.getByRole('link', { name: '保存 PNG' }).click()
      const download = await downloadWait; assert.equal(download.suggestedFilename(), 'ecfc-activity-result.png')
      assert.deepEqual(readFileSync((await download.path())!), png, 'download is the same PNG, not a second render')
      assert.equal(readFileSync((await download.path())!).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      await page.getByText('微信内可长按图片保存。').waitFor()
      await page.evaluate("Object.defineProperty(navigator, 'canShare', { configurable: true, value: function () { return false } })")
      await page.getByRole('button', { name: '分享结果图片' }).click()
      await page.getByRole('alert').filter({ hasText: '当前浏览器请长按海报或点击保存 PNG' }).waitFor()
      // Browser-contract stub only, not a physical OS share-sheet acceptance.
      await page.evaluate(`
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: function (value) { return value.files?.[0]?.type === 'image/png' } })
        Object.defineProperty(navigator, 'share', { configurable: true, value: async function (value) {
          const file = value.files?.[0]
          if (!file || file.type !== 'image/png' || file.size <= 0) throw new Error('invalid share file')
          document.documentElement.dataset.sharedPng = file.name
          document.documentElement.dataset.sharedBytes = JSON.stringify(Array.from(new Uint8Array(await file.arrayBuffer())))
        } })
      `)
      await page.getByRole('button', { name: '分享结果图片' }).click()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.sharedPng), 'ecfc-activity-result.png')
      assert.deepEqual(Buffer.from(JSON.parse((await page.evaluate(() => document.documentElement.dataset.sharedBytes))!)), png, 'share uses the exact preview/download PNG')
      personality = true
      await open('test'); await page.getByRole('radio', { name: '正确', exact: true }).check(); await page.getByRole('button', { name: '下一题' }).click()
      await page.getByRole('radio', { name: '第二题选项A' }).check(); await page.getByRole('button', { name: '提交测试' }).click()
      await page.getByRole('heading', { name: '趣味测试结果', exact: true }).waitFor()
      assert.equal(await page.getByText('得分：', { exact: false }).count(), 0, 'personality result is not a knowledge score')
      await page.reload(); await page.getByRole('heading', { name: '我的历史结果', exact: true }).waitFor()
      await page.getByRole('button', { name: /趣味测试结果 ·/ }).click()
      await page.getByRole('heading', { name: '趣味测试结果', exact: true }).waitFor()
      assert.equal(testWrites, 2, 'restoring history is read-only')
      personality = false
      await open('review'); await page.getByRole('button', { name: '通过', exact: true }).click(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(reviewWrites, 0)
      await page.getByRole('button', { name: '拒绝', exact: true }).click(); await page.getByRole('dialog').locator('textarea').fill('本地拒绝原因')
      await page.getByRole('button', { name: '确认拒绝' }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByRole('alert').waitFor(); assert.equal(reviewWrites, 1); assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await page.getByRole('dialog').locator('textarea').inputValue(), '本地拒绝原因'); await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('button', { name: '审核记录' }).click(); await page.getByText('测试管理员', { exact: false }).waitFor()
      await open('panel'); await page.getByRole('button', { name: /weibo.*尚未提交/ }).click()
      await page.getByRole('button', { name: '提交审核', exact: true }).click(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(taskWrites, 0)
      await page.getByRole('button', { name: '提交审核', exact: true }).click()
      await page.getByRole('button', { name: '确认提交', exact: true }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByText('任务已提交，等待管理员审核。', { exact: true }).waitFor(); assert.equal(taskWrites, 1)
      const resultLink = page.getByRole('link', { name: '查看测试结果 / 再次测试' })
      const resultHref = await resultLink.getAttribute('href')
      assert.match(resultHref || '', /attemptId=attempt-two/u)
      await page.goto('http://127.0.0.1:' + port + '/?mode=test&attemptId=attempt-two')
      await page.getByRole('heading', { name: '趣味测试结果', exact: true }).waitFor()
      await open('editor'); await page.getByRole('button', { name: /配置/ }).click(); await page.getByText('平台奖励', { exact: true }).waitFor()
      assert.equal(await page.locator('textarea').count() > 0, true); assert.equal(configWrites, 0)
      const resultPoster = page.getByAltText('结果海报背景预览')
      await resultPoster.waitFor()
      assert.match(await resultPoster.getAttribute('src') || '', /old-poster\.webp/u)
      assert.equal(await page.getByLabel('统一结果海报背景上传文件').count(), 1)
      assert.equal(await page.getByRole('group', { name: /^结果 \d+ 图片$/u }).count(), 0, 'there is no result-level poster uploader')
      const previewCanvas = page.getByLabel('结果海报布局预览').locator('[data-preview-result-id]')
      assert.equal(await previewCanvas.getAttribute('data-preview-background'), '/uploads/old-poster.webp', 'global background takes precedence over legacy result images')
      await page.getByLabel('预览测试结果').selectOption('second')
      assert.equal(await previewCanvas.getAttribute('data-preview-result-id'), 'second', 'result selector changes the displayed result text')
      assert.equal(await previewCanvas.getAttribute('data-preview-background'), '/uploads/old-poster.webp', 'all result previews retain the same global background')
      await page.getByLabel('统一结果海报背景上传文件').setInputFiles({ name: 'failed-poster.png', mimeType: 'image/png', buffer: Buffer.from('fixture') })
      await page.getByRole('alert').filter({ hasText: '未替换当前统一海报背景' }).waitFor()
      assert.match(await resultPoster.getAttribute('src') || '', /old-poster\.webp/u, 'failed uploads keep and restore the saved shared background preview')
      uploadShouldFail = false
      await page.getByLabel('统一结果海报背景上传文件').setInputFiles({ name: 'new-poster.png', mimeType: 'image/png', buffer: Buffer.from('fixture') })
      try {
        await page.getByText('上传成功', { exact: true }).waitFor({ timeout: 15000 })
        await page.waitForFunction(() => document.querySelector('[data-preview-result-id]')?.getAttribute('data-preview-background') === '/cos/activities/22222222-2222-4222-8222-222222222222/source.webp')
        assert.equal(await previewCanvas.getAttribute('data-preview-result-id'), 'second', 'uploading the shared background does not reset the selected result')
      } catch {
        const statuses = await page.getByRole('status').allTextContents()
        const alerts = await page.getByRole('alert').allTextContents()
        const bodyText = (await page.locator('body').innerText()).slice(-1600)
        throw new Error(`poster background upload did not succeed; requests=${uploadRequests}; url=${page.url()}; closed=${page.isClosed()}; pageErrors=${errors.join('|')}; statuses=${statuses.join('|')}; alerts=${alerts.join('|')}; page=${bodyText}`)
      }
      await page.getByLabel('入口标题', { exact: true }).fill('更新入口标题')
      await page.getByRole('button', { name: '保存活动模块配置', exact: true }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByText('活动模块配置已保存并回读确认。', { exact: true }).waitFor(); assert.equal(configWrites, 1)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at width ' + width)
      if (process.env.TOPIC_V2_QA_ARTIFACTS && width === 390) await page.screenshot({ path: join(process.env.TOPIC_V2_QA_ARTIFACTS, 'v2-admin-390.png'), fullPage: true })
      assert.deepEqual(errors, [], 'actual components should not crash at width ' + width)
      await context.close()
    }
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
