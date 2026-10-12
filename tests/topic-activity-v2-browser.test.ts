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

test('V2 actual Web components: vote/test/PNG/review/admin editing at desktop and mobile widths', { skip: process.env.TOPIC_V2_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const f = fixture()
  f.program.test.questions.push({ id: 'q2', prompt: '第二题', points: 0, options: [{ id: 'a2', label: '第二题选项A' }, { id: 'b2', label: '第二题选项B' }], correctOptionId: 'a2' })
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityV2PollPanel,TopicActivityV2TestRunner} from './components/activities/TopicActivityV2Interactive'; import {TopicActivityV2TaskReview} from './components/activities/TopicActivityV2TaskReview'; import {TopicActivityV2Editor} from './components/activities/TopicActivityV2Editor'; import {TopicActivityV2Panel} from './components/activities/TopicActivityV2Panel'; const mode=new URLSearchParams(location.search).get('mode'); createRoot(document.getElementById('root')).render(mode==='panel'?<TopicActivityV2Panel activityId="activity-one" isAuthenticated={true} currentUserId="user-one"/>:mode==='test'?<TopicActivityV2TestRunner activityId="activity-one" isAuthenticated={true}/>:mode==='review'?<TopicActivityV2TaskReview activityId="activity-one" canReview={true} submission={{id:'submission-one',status:'PENDING',rewardEntryId:'weibo',rewardSnapshotSafe:{platformName:'微博',title:'分享任务',points:96,instructions:'提交截图'}}}/>:mode==='editor'?<TopicActivityV2Editor activityId="activity-one"/>:<TopicActivityV2PollPanel activityId="activity-one" isAuthenticated={true}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'normal-next-link-fixture', setup(build: { onResolve: (options: { filter: RegExp }, callback: () => { path: string; namespace: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void }) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'navigation-fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }', loader: 'js', resolveDir: process.cwd() }))
      build.onLoad({ filter: /.*/, namespace: 'navigation-fixture' }, () => ({ contents: 'export function useRouter(){return {refresh(){},push(){}}} export function usePathname(){return "/fixture"} export function useSearchParams(){return new URLSearchParams(location.search)}', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const postcss = require('postcss'), tailwind = require('tailwindcss')
  const css = (await postcss([tailwind({ ...require('./tailwind.config.ts').default, content: [{ raw: build.outputFiles[0].text, extension: 'js' }] })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css
  let votes: string[] = [], voteWrites = 0, testWrites = 0, reviewWrites = 0, configWrites = 0, taskWrites = 0
  const attempts: Array<Record<string, unknown>> = []
  const png = await renderTopicV2Poster({ title: '本地结果', description: '已完成测试', poster: { width: 360, height: 640 } }, 'activity-one')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
    const body = async () => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString()) }
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(build.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname === '/api/activities/activity-one/v2') return send({ program: publicTopicActivityV2Program(f.program), entries: f.program.entries, myProgress: null, activity: { status: 'PUBLISHED', startsAt: null, endsAt: null, activityPostId: null, allowImageAttachments: true } })
    if (url.pathname.endsWith('/v2/tasks') && req.method === 'POST') { const input = await body(); assert.equal(input.rewardEntryId, 'weibo'); taskWrites++; return send({ submission: { status: 'PENDING' } }, 201) }
    if (url.pathname.endsWith('/poster')) { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    if (url.pathname.endsWith('/v2/poll')) {
      if (req.method === 'POST') { votes = (await body()).choices; voteWrites++; return send({ changed: true }) }
      return send({ poll: f.program.poll, myChoices: votes, results: { participantCount: votes.length ? 1 : 0, options: [{ id: 'a', label: 'A', count: votes.length, percentage: votes.length ? 100 : 0 }] } })
    }
    if (url.pathname.endsWith('/v2/test')) {
      if (req.method === 'POST') {
        const input = await body(); assert.equal('score' in input, false); assert.equal('resultId' in input, false); assert.deepEqual(input.answers, { q1: 'yes', q2: 'a2' }); testWrites++
        const attempt = { id: 'attempt-one', resultSnapshot: { title: '服务端真实结果', description: '结果说明', score: 2, maxScore: 2, testTitle: '知识测试' }, completedAt: new Date().toISOString() }; attempts.push(attempt); return send({ attempt })
      }
      return send({ activity: { title: '本地活动' }, test: publicTopicActivityV2Program(f.program).test })
    }
    if (url.pathname.endsWith('/v2/attempts')) return send({ attempts })
    if (url.pathname.endsWith('/v2/submissions/submission-one')) {
      if (req.method === 'PATCH') { reviewWrites++; await body(); await new Promise((resolve) => setTimeout(resolve, 100)); return send({ message: '审核失败，页面保留' }, 500) }
      return send({ history: [{ id: 'log-one', fromStatus: 'PENDING', toStatus: 'REJECTED', reason: '本地原因', reviewedAt: new Date().toISOString(), ReviewedBy: { nickname: '测试管理员' } }] })
    }
    if (url.pathname.endsWith('/v2/fixed-reward')) return send({ claims: [] })
    if (url.pathname.endsWith('/activities/badges')) return send({ badges: [] })
    if (url.pathname === '/api/admin/activities/activity-one/v2') {
      if (req.method === 'PATCH') { const input = await body(); assert.equal(input.program.entries.length, 1); configWrites++; return send({ program: input.program }) }
      return send({ program: f.program, activity: { activityPostId: 'post-one' }, statistics: { pollResults: [], entries: [], platforms: [] } })
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
  try {
    for (const width of [1024, 360, 390, 430]) {
      votes = []; voteWrites = 0; testWrites = 0; reviewWrites = 0; configWrites = 0; taskWrites = 0; attempts.length = 0
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
      const downloadWait = page.waitForEvent('download'); await page.getByRole('link', { name: '保存 PNG' }).click(); assert.equal((await downloadWait).suggestedFilename(), 'ecfc-activity-result.png')
      await page.getByText('微信内可长按图片保存。').waitFor()
      await open('review'); await page.getByRole('button', { name: '通过任务' }).click(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(reviewWrites, 0)
      await page.getByRole('button', { name: '拒绝任务' }).click(); await page.getByRole('dialog').locator('textarea').fill('本地拒绝原因')
      await page.getByRole('button', { name: '确认拒绝' }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByRole('alert').waitFor(); assert.equal(reviewWrites, 1); assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await page.getByRole('dialog').locator('textarea').inputValue(), '本地拒绝原因'); await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('button', { name: '查看审核历史' }).click(); await page.getByText('测试管理员', { exact: false }).waitFor()
      await open('panel'); await page.getByRole('button', { name: '提交weibo截图' }).click()
      await page.getByRole('button', { name: '确认提交待审核' }).click(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(taskWrites, 0)
      await page.getByRole('button', { name: '确认提交待审核' }).click()
      await page.getByRole('button', { name: '确认提交', exact: true }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByText('任务已提交，等待管理员审核。', { exact: true }).waitFor(); assert.equal(taskWrites, 1)
      await open('editor'); await page.getByRole('button', { name: /配置/ }).click(); await page.getByText('平台奖励', { exact: true }).waitFor()
      assert.equal(await page.locator('textarea').count() > 0, true); assert.equal(configWrites, 0)
      await page.getByLabel('入口标题', { exact: true }).fill('更新入口标题')
      await page.getByRole('button', { name: '保存活动模块配置', exact: true }).evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
      await page.getByText('活动模块配置已保存。', { exact: true }).waitFor(); assert.equal(configWrites, 1)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at width ' + width)
      if (process.env.TOPIC_V2_QA_ARTIFACTS && width === 390) await page.screenshot({ path: join(process.env.TOPIC_V2_QA_ARTIFACTS, 'v2-admin-390.png'), fullPage: true })
      assert.deepEqual(errors, [], 'actual components should not crash at width ' + width)
      await context.close()
    }
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})
