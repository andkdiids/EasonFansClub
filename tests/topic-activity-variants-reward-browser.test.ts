import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { fixture, instant, rewardEntry } from './fixtures/topic-v2-transaction'
import { getTopicV2Attempts, getTopicV2Test, submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { dispatchDueTopicActivityV2Rewards, reviewTopicActivityV2Submission, saveTopicActivityV2Program } from '@/lib/topic-activity-v2'
import { normalizeTopicActivityConfig } from '@/lib/topic-activity-config'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { parseBadgeRuleInput } from '@/lib/badge-rules'

test('real result editor/runner and reward settings persist correctly on desktop/mobile', { skip: process.env.TOPIC_V2_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const client = require.resolve('react-dom/client')
  const aliases = new Map([['react', require.resolve('react')], ['react/jsx-runtime', require.resolve('react/jsx-runtime')], ['react-dom', require.resolve('react-dom')], ['react-dom/client', client], ['scheduler', createRequire(client).resolve('scheduler')]])
  const bundle = await esbuild.build({
    stdin: { contents: [
      "import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {TopicActivityWizardTestEditor} from './components/activities/TopicActivityWizardTestEditor';import {TopicActivityRewardReleaseSettings} from './components/activities/TopicActivityRewardReleaseEditor';import {TopicActivityV2TestRunner} from './components/activities/TopicActivityV2Interactive';",
      "import {BadgeAdminManager} from './app/admin/badges/BadgeAdminManager';function BadgeHost(){const[value,setValue]=useState(null);useEffect(()=>{fetch('/api/admin/badges').then(r=>r.json()).then(r=>setValue(r.badges))},[]);return value?<BadgeAdminManager initialBadges={value}/>:null}",
      "function Editor(){const[value,setValue]=useState(null);const[message,setMessage]=useState('');useEffect(()=>{fetch('/fixture/program').then(r=>r.json()).then(p=>setValue(p.test))},[]);return value?<><TopicActivityWizardTestEditor value={value} onChange={setValue}/><button onClick={async()=>{const r=await fetch('/fixture/program',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({test:value})});if(!r.ok)throw Error(await r.text());setMessage('测试配置已保存')}}>保存测试配置</button><p role='status'>{message}</p></>:null}",
      "const mode=new URLSearchParams(location.search).get('mode');createRoot(document.getElementById('root')).render(mode==='badge'?<BadgeHost/>:mode==='editor'?<Editor/>:mode==='reward'?<TopicActivityRewardReleaseSettings activityId='activity-one'/>:<TopicActivityV2TestRunner activityId='activity-one' isAuthenticated={true}/>);",
    ].join(''), loader: 'tsx', resolveDir: process.cwd() },
    absWorkingDir: process.cwd(), bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '"https://media.ecfc.fans/media"' },
    plugins: [{ name: 'local-components', setup(builder: {
      onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace?: string }) => void
      onLoad: (options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }) => void
    }) {
      builder.onResolve({ filter: /^(react(?:\/jsx-runtime)?|react-dom(?:\/client)?|scheduler)$/ }, ({ path }) => ({ path: aliases.get(path)! }))
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'local-next' }))
      builder.onLoad({ filter: /.*/, namespace: 'local-next' }, () => ({ contents: 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}', loader: 'js', resolveDir: process.cwd() }))
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'local-navigation' }))
      builder.onLoad({ filter: /.*/, namespace: 'local-navigation' }, () => ({ contents: 'export function useSearchParams(){return new URLSearchParams(location.search)}', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const css = (await require('postcss')([require('tailwindcss')({ ...require('./tailwind.config.ts').default, content: [{ raw: bundle.outputFiles[0].text, extension: 'js' }] })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css as string
  for (const width of [1280, 390]) await t.test(String(width) + 'px variants, result/PNG/share, scheduled/immediate reward', async () => {
    const f = fixture([rewardEntry('weibo', 'weibo'), rewardEntry('red', 'red')])
    f.program.test.results = [{ id: 'result-one', title: '尘大师', description: '说明 A', scoreMin: 0, scoreMax: 2 }]
    await f.run(async () => {
      let latestPng: Buffer | null = null
      let savedBadge: Record<string, unknown> | null = null
      const server = createServer(async (request, response) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1')
        const send = (value: unknown, status = 200) => { response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)) }
        const body = async () => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown> }
        try {
          if (url.pathname === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
          if (url.pathname === '/style.css') { response.setHeader('content-type', 'text/css'); response.end(css); return }
          if (url.pathname === '/api/admin/badges/series') return send({ series: [] })
          if (url.pathname === '/api/music/concerts/options') return send({ tours: [] })
          if (url.pathname === '/api/admin/badges/activities') return send({ activities: [{ id: 'activity-none', title: '无核销线下活动', status: 'PUBLISHED', startsAt: instant.toISOString(), endsAt: instant.toISOString(), verificationMode: 'NONE' }] })
          if (url.pathname === '/api/admin/badges') {
            if (request.method === 'POST') {
              const value = await body(), parsed = parseBadgeRuleInput(value.rule)
              if (parsed.error || !parsed.rule) return send({ message: parsed.error || '缺少规则' }, 400)
              assert.equal(parsed.rule.ruleType, 'ACTIVITY_PARTICIPATION')
              assert.deepEqual(parsed.rule.configJson, { activityId: 'activity-none' })
              savedBadge = { ...value, id: 'badge-browser', code: 'local-ui-badge', slug: 'local-ui-badge', rule: { ...parsed.rule, id: 'rule-browser' },
                ownerCount: 0, ownershipStats: null, series: null, createdAt: instant.toISOString(), resolvedAcquisitionDescription: value.acquisitionDescription }
              return send({ badge: savedBadge }, 201)
            }
            return send({ badges: savedBadge ? [savedBadge] : [] })
          }
          if (url.pathname === '/fixture/program') {
            if (request.method === 'PATCH') { const value = await body(); await saveTopicActivityV2Program(f.activity.id, 'admin-one', { ...f.activity.topicProgram, test: value.test }) }
            return send(f.activity.topicProgram)
          }
          if (url.pathname === '/api/admin/activities/activity-one') {
            if (request.method === 'PATCH') {
              const normalized = normalizeTopicActivityConfig(await body(), 'TOPIC_ACTIVITY', f.activity)
              if (!normalized.valid) return send({ message: normalized.message }, 400)
              f.activity.rewardGrantMode = normalized.value.rewardGrantMode; f.activity.rewardGrantAt = normalized.value.rewardGrantAt
            }
            return send({ activity: f.activity })
          }
          if (url.pathname === '/api/activities/activity-one/v2/test') {
            if (request.method === 'POST') { const value = await body(); return send(await submitTopicV2Test({ activityId: f.activity.id, userId: 'user-one', answers: value.answers, requestKey: String(value.requestKey), now: instant })) }
            return send(await getTopicV2Test(f.activity.id))
          }
          if (url.pathname === '/api/activities/activity-one/v2/attempts') return send({ attempts: await getTopicV2Attempts(f.activity.id, 'user-one') })
          if (url.pathname.endsWith('/poster')) {
            const id = url.pathname.split('/').at(-2)
            const attempt = f.state.attempts.find((item: { id: string }) => item.id === id)
            latestPng = await renderTopicV2Poster(attempt.resultSnapshot, f.activity.id)
            response.setHeader('content-type', 'image/png'); response.end(latestPng); return
          }
          if (url.pathname === '/fixture/review') {
            const value = await body(), entry = f.activity.topicProgram.entries[value.immediate ? 1 : 0]
            const id = value.immediate ? 'immediate-submission' : 'scheduled-submission'
            if (!f.state.submissions.some((item: { id: string }) => item.id === id)) f.submission(id, entry)
            await reviewTopicActivityV2Submission({ submissionId: id, reviewerId: 'admin-one', status: 'APPROVED', now: instant })
            return send({ status: f.state.submissions.find((item: { id: string }) => item.id === id).status, logs: f.state.logs.length })
          }
          if (url.pathname === '/fixture/dispatch') { await dispatchDueTopicActivityV2Rewards({ now: f.activity.rewardGrantAt || instant }); return send({ logs: f.state.logs.length }) }
          response.setHeader('content-type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>')
        } catch (error) { send({ message: error instanceof Error ? error.message : 'Local fixture failure' }, 500) }
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address(); assert.ok(address && typeof address !== 'string')
      const base = 'http://127.0.0.1:' + address.port
      const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
      try {
        assert.equal((await fetch(base)).status, 200)
        browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) })
        const page = await browser.newPage({ viewport: { width, height: 900 } })
        // Raw fixture JavaScript avoids tsx helper references in serialized browser callbacks.
        await page.addInitScript({ content: "Object.defineProperty(navigator,'canShare',{configurable:true,value:function(){return true}});Object.defineProperty(navigator,'share',{configurable:true,value:async function(value){const file=value.files[0];window.sharedPng=Array.from(new Uint8Array(await file.arrayBuffer()))}});" })
        await page.goto(base + '/?mode=editor')
        await page.getByRole('button', { name: '+ 添加结果说明', exact: true }).click()
        await page.getByRole('textbox', { name: '说明 2', exact: true }).fill('说明 B')
        await page.getByRole('button', { name: '+ 添加结果说明', exact: true }).click()
        await page.getByRole('textbox', { name: '说明 3', exact: true }).fill('说明 C')
        await page.getByRole('button', { name: '保存测试配置', exact: true }).click()
        await page.getByText('测试配置已保存', { exact: true }).waitFor()
        const ids = f.activity.topicProgram.test.results[0].descriptionVariants.map((item: { id: string }) => item.id)
        await page.reload()
        assert.equal(await page.getByRole('textbox', { name: '说明 2', exact: true }).inputValue(), '说明 B')
        assert.equal(await page.getByRole('textbox', { name: '说明 3', exact: true }).inputValue(), '说明 C')
        assert.deepEqual(f.activity.topicProgram.test.results[0].descriptionVariants.map((item: { id: string }) => item.id), ids)
        await page.goto(base + '/?mode=user')
        await page.getByRole('radio', { name: '正确', exact: true }).check()
        await page.getByRole('button', { name: '提交测试', exact: true }).click()
        await page.getByRole('heading', { name: '尘大师', exact: true }).waitFor()
        const frozen = structuredClone(f.state.attempts[0].resultSnapshot)
        assert.ok(['说明 A', '说明 B', '说明 C'].includes(frozen.description))
        await page.reload(); await page.getByText(frozen.description, { exact: true }).waitFor()
        await page.getByRole('button', { name: /^尘大师 ·/ }).click()
        await page.getByText(frozen.description, { exact: true }).waitFor()
        await page.getByRole('button', { name: '生成结果海报', exact: true }).click()
        const image = page.getByAltText('我的测试结果海报', { exact: true }); await image.waitFor()
        const preview = await image.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())))
        assert.deepEqual(Buffer.from(preview), latestPng)
        const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: '保存 PNG', exact: true }).click()
        const file = await (await downloadPromise).path(); assert.ok(file); assert.deepEqual(readFileSync(file), latestPng)
        await page.getByRole('button', { name: '分享结果图片', exact: true }).click()
        await page.waitForFunction(() => Array.isArray(Reflect.get(window, 'sharedPng')))
        assert.deepEqual(Buffer.from(await page.evaluate(() => Reflect.get(window, 'sharedPng'))), latestPng)
        assert.deepEqual(f.state.attempts[0].resultSnapshot, frozen)
        await page.goto(base + '/?mode=reward')
        await page.getByRole('combobox', { name: '发放方式', exact: true }).selectOption('SCHEDULED')
        await page.getByLabel('统一发奖时间（北京时间）', { exact: true }).fill('2099-11-03T20:00')
        await page.getByRole('button', { name: '保存发奖安排', exact: true }).click()
        await page.getByText('发奖安排已保存并回读确认', { exact: true }).waitFor()
        assert.equal(f.activity.rewardGrantAt.toISOString(), '2099-11-03T12:00:00.000Z')
        await page.reload()
        assert.equal(await page.getByRole('combobox', { name: '发放方式', exact: true }).inputValue(), 'SCHEDULED')
        assert.equal(await page.getByLabel('统一发奖时间（北京时间）', { exact: true }).inputValue(), '2099-11-03T20:00')
        assert.deepEqual(await page.evaluate(async () => (await fetch('/fixture/review', { method: 'POST', body: '{}' })).json()), { status: 'APPROVED', logs: 0 })
        for (let run = 0; run < 2; run++) assert.deepEqual(await page.evaluate(async () => (await fetch('/fixture/dispatch', { method: 'POST' })).json()), { logs: 1 })
        await page.getByRole('combobox', { name: '发放方式', exact: true }).selectOption('IMMEDIATE')
        await page.getByRole('button', { name: '保存发奖安排', exact: true }).click()
        await page.getByText('发奖安排已保存并回读确认', { exact: true }).waitFor()
        assert.deepEqual(await page.evaluate(async () => (await fetch('/fixture/review', { method: 'POST', body: JSON.stringify({ immediate: true }) })).json()), { status: 'APPROVED', logs: 2 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.goto(base + '/?mode=badge')
        await page.getByRole('button', { name: '新增勋章', exact: true }).click()
        const badgeForm = page.locator('form').filter({ has: page.getByRole('button', { name: '保存勋章', exact: true }) })
        await badgeForm.getByLabel('勋章名称', { exact: true }).fill('无核销参与限定勋章')
        await badgeForm.getByRole('combobox', { name: '发放类型', exact: true }).selectOption('AUTO')
        await badgeForm.getByRole('combobox', { name: '获得规则', exact: true }).selectOption('ACTIVITY_PARTICIPATION')
        await badgeForm.getByRole('combobox', { name: /^选择活动/ }).selectOption('activity-none')
        await page.getByText(/无核销要求的活动在结束后由有效报名计入/).waitFor()
        await page.getByRole('button', { name: '保存勋章', exact: true }).click()
        await page.getByText('勋章已创建', { exact: true }).waitFor()
        await page.reload()
        await page.getByRole('button', { name: '编辑', exact: true }).click()
        assert.equal(await page.getByRole('combobox', { name: '获得规则', exact: true }).inputValue(), 'ACTIVITY_PARTICIPATION')
        assert.equal(await page.getByRole('combobox', { name: /^选择活动/ }).inputValue(), 'activity-none')
      } finally { await browser?.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
    })
  })
})
