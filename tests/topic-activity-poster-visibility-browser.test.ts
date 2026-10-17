import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Page } from 'playwright'
import { fixture } from './fixtures/topic-v2-transaction'
import { publicTopicActivityV2Program, type TopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'

test('poster visibility: actual admin and wizard switches, persisted re-entry, and identical preview/download/share for all combinations', { skip: process.env.TOPIC_V2_BROWSER_QA !== '1' }, async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> }
  const reactDomClient = require.resolve('react-dom/client')
  const resolved = new Map([
    ['react', require.resolve('react')], ['react/jsx-runtime', require.resolve('react/jsx-runtime')],
    ['react-dom', require.resolve('react-dom')], ['react-dom/client', reactDomClient],
    ['scheduler', createRequire(reactDomClient).resolve('scheduler')],
  ])
  const build = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {TopicActivityV2Editor} from './components/activities/TopicActivityV2Editor'; import {TopicActivityWizardTestEditor} from './components/activities/TopicActivityWizardTestEditor'; import {TopicActivityV2TestRunner} from './components/activities/TopicActivityV2Interactive'; import {createDefaultTopicActivityV2Program} from './lib/topic-activity-v2-config'; function Wizard(){const [value,setValue]=useState(()=>({...createDefaultTopicActivityV2Program().test,enabled:true}));return <TopicActivityWizardTestEditor value={value} onChange={setValue}/>}; const mode=new URLSearchParams(location.search).get('mode'); createRoot(document.getElementById('root')).render(mode==='test'?<TopicActivityV2TestRunner activityId="activity-one" isAuthenticated={true}/>:mode==='wizard'?<Wizard/>:<TopicActivityV2Editor activityId="activity-one"/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), nodePaths: [join(process.cwd(), 'node_modules')], bundle: true,
    write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '"https://media.ecfc.fans/media"' },
    plugins: [{ name: 'local-browser-fixture', setup(builder: {
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
      builder.onLoad({ filter: /.*/, namespace: 'local-link' }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}){return React.createElement("a",props,children)}', loader: 'js', resolveDir: process.cwd() }))
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'local-navigation' }))
      builder.onLoad({ filter: /.*/, namespace: 'local-navigation' }, () => ({ contents: 'export function useRouter(){return {refresh(){},push(){}}} export function usePathname(){return "/fixture"} export function useSearchParams(){return new URLSearchParams(location.search)}', loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const css = (await require('postcss')([require('tailwindcss')({ ...require('./tailwind.config.ts').default, content: [{ raw: build.outputFiles[0].text, extension: 'js' }] })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css
  let program: TopicActivityV2Program = fixture().program
  // The persisted legacy fixture genuinely omits both flags; normal production readers must default them off.
  Reflect.deleteProperty(program.test.poster, 'showNickname')
  Reflect.deleteProperty(program.test.poster, 'showQrCode')
  let writes = 0, posterRequests = 0
  let servedPng = Buffer.alloc(0)
  const attempt = () => ({ id: 'visibility-attempt', testId: program.test.id, configVersion: program.test.version,
    resultSnapshot: { title: '本地结果', description: '隐私配置浏览器验收', nickname: '示例昵称', testTitle: program.test.title, poster: program.test.poster }, completedAt: '2026-10-17T00:00:00Z' })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    try {
      if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(build.outputFiles[0].text); return }
      if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
      if (url.pathname === '/icons/icon-512.png') { res.setHeader('Content-Type', 'image/png'); res.end(readFileSync('public/icons/icon-512.png')); return }
      if (url.pathname === '/api/admin/activities/activity-one/v2') {
        if (req.method === 'PATCH') {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
          const input = JSON.parse(Buffer.concat(chunks).toString())
          assert.deepEqual(Object.keys(input), ['program'])
          program = input.program; writes++
        }
        return send({ program, activity: { activityPostId: null }, statistics: { pollResults: [], entries: [], platforms: [] } })
      }
      if (url.pathname === '/api/admin/activities/badges') return send({ badges: [] })
      if (url.pathname.endsWith('/v2/test')) return send({ activity: { title: '本地活动' }, test: publicTopicActivityV2Program(program).test })
      if (url.pathname.endsWith('/v2/attempts')) return send({ attempts: [attempt()] })
      if (url.pathname.endsWith('/poster')) {
        posterRequests++
        servedPng = await renderTopicV2Poster(attempt().resultSnapshot, 'activity-one')
        res.setHeader('Content-Type', 'image/png'); res.end(servedPng); return
      }
      if (url.pathname.startsWith('/api/')) return send({ claims: [], winners: [], entries: [] })
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
    } catch (error) { send({ message: error instanceof Error ? error.message : 'local fixture failure' }, 500) }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  async function assertPreview(page: Page, nickname: boolean, qr: boolean) {
    const preview = page.locator('[aria-label="结果海报布局预览"]')
    await preview.waitFor()
    const svg = await preview.getByAltText('结果海报布局预览').getAttribute('src')
    assert.ok(svg?.startsWith('data:image/svg+xml'))
    const source = svg!.includes(';base64,') ? Buffer.from(svg!.split(',')[1], 'base64').toString() : decodeURIComponent(svg!.slice(svg!.indexOf(',') + 1))
    assert.equal(source.includes('示例昵称'), nickname, 'actual layout preview reflects nickname switch immediately')
    if (qr) await preview.getByAltText('活动二维码预览').waitFor()
    assert.equal(await preview.getByAltText('活动二维码预览').count(), qr ? 1 : 0)
    assert.equal(await preview.getByAltText('ECFC 标志').count(), qr ? 1 : 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'preview fits the viewport')
  }
  try {
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1024, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      // No external hosts, production APIs, real uploads, or native share sheets are used.
      await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, (route) => route.abort())
      const page = await context.newPage(), errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const open = (mode: string) => page.goto(`http://127.0.0.1:${port}/?mode=${mode}`)
      if (width === 1024) {
        await open('editor'); await page.getByRole('button', { name: '互动与平台奖励配置', exact: true }).click()
        await page.getByLabel('显示昵称', { exact: true }).waitFor()
        assert.equal(await page.getByLabel('显示昵称', { exact: true }).isChecked(), false)
        assert.equal(await page.getByLabel('显示活动二维码', { exact: true }).isChecked(), false)
        await assertPreview(page, false, false)
      }
      for (const [nickname, qr] of [[true, true], [false, true], [true, false], [false, false]]) {
        await open('editor'); await page.getByRole('button', { name: '互动与平台奖励配置', exact: true }).click()
        await page.getByLabel('显示昵称', { exact: true }).waitFor()
        await page.getByLabel('显示昵称', { exact: true }).setChecked(nickname)
        await page.getByLabel('显示活动二维码', { exact: true }).setChecked(qr)
        await assertPreview(page, nickname, qr)
        const previousWrites = writes
        await page.getByRole('button', { name: '保存活动模块配置', exact: true }).click()
        await page.getByText('活动模块配置已保存并回读确认。', { exact: true }).waitFor()
        assert.equal(writes, previousWrites + 1)
        assert.equal(program.test.poster.showNickname, nickname)
        assert.equal(program.test.poster.showQrCode, qr)
        await page.reload(); await page.getByRole('button', { name: '互动与平台奖励配置', exact: true }).click()
        await page.getByLabel('显示昵称', { exact: true }).waitFor()
        assert.equal(await page.getByLabel('显示昵称', { exact: true }).isChecked(), nickname)
        assert.equal(await page.getByLabel('显示活动二维码', { exact: true }).isChecked(), qr)
        await assertPreview(page, nickname, qr)

        await open('test&attemptId=visibility-attempt')
        await page.getByRole('heading', { name: '本地结果', exact: true }).waitFor()
        const previousRequests = posterRequests
        await page.getByRole('button', { name: '生成结果海报', exact: true }).click()
        const image = page.getByAltText('我的测试结果海报')
        await image.waitFor()
        await image.evaluate((element) => (element as HTMLImageElement).decode())
        assert.deepEqual(await image.evaluate((element) => [(element as HTMLImageElement).naturalWidth, (element as HTMLImageElement).naturalHeight]), [1080, 1920])
        const bytes = await image.evaluate(async (element) => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())))
        assert.deepEqual(Buffer.from(bytes), servedPng)
        const downloadPromise = page.waitForEvent('download')
        await page.getByRole('link', { name: '保存 PNG', exact: true }).click()
        const download = await downloadPromise
        assert.deepEqual(readFileSync((await download.path())!), servedPng, 'download retains the original generated PNG')
        // Contract-level navigator stub, not a claim of iPhone/WeChat native sharing QA.
        await page.evaluate(`Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{document.documentElement.dataset.sharedBytes=JSON.stringify(Array.from(new Uint8Array(await files[0].arrayBuffer())))}})`)
        await page.getByRole('button', { name: '分享结果图片', exact: true }).click()
        await page.waitForFunction(() => Boolean(document.documentElement.dataset.sharedBytes))
        const shared = await page.evaluate(() => document.documentElement.dataset.sharedBytes!)
        assert.deepEqual(Buffer.from(JSON.parse(shared)), servedPng, 'share retains the same preview PNG bytes')
        assert.equal(posterRequests, previousRequests + 1, 'download/share do not independently re-render or fetch another poster')
      }
      await open('wizard')
      await page.getByText('分享海报设置', { exact: true }).click()
      assert.equal(await page.getByLabel('显示昵称', { exact: true }).isChecked(), false)
      assert.equal(await page.getByLabel('显示活动二维码', { exact: true }).isChecked(), false)
      for (const [nickname, qr] of [[false, false], [true, true], [true, false], [false, true]]) {
        await page.getByLabel('显示昵称', { exact: true }).setChecked(nickname)
        await page.getByLabel('显示活动二维码', { exact: true }).setChecked(qr)
        await assertPreview(page, nickname, qr)
      }
      assert.deepEqual(errors, [], 'actual editor/runner components do not crash')
      await context.close()
    }
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
