import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { buildTopicActivityPostContent, syncActivityPostInTransaction } from '@/lib/topic-activity'
import { topicPostSyncFixture } from './fixtures/topic-post-sync'

test('actual post info JSX and RichPostContent: new posts do not duplicate; unproven legacy and authored bodies stay visible', { skip: process.env.TOPIC_V3_POST_BODY_BROWSER_QA !== '1' }, async (t) => {
  const f = topicPostSyncFixture()
  await syncActivityPostInTransaction(f.tx, f.activity.id)
  const fixtures = {
    new: { body: f.post.content!, topic: true },
    legacy: { body: buildTopicActivityPostContent(f.activity, ['本地勋章']), topic: true },
    authored: { body: '我觉得这个活动的参与方式很简单，活动时间也很合适。\n测试\n参与方式\n活动时间', topic: true },
    title: { body: f.activity.title, topic: true },
    ordinary: { body: '普通帖子：参与方式\n活动时间\n本地话题活动', topic: false },
  }
  // Exercise the exact production JSX, not a replacement info-card mock. Full
  // server-page auth/DB loading is intentionally outside this local browser fixture.
  const source = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  const start = source.indexOf('{topicActivity ? <section aria-label="话题活动信息"')
  const end = source.indexOf('<RichPostContent', start)
  assert.ok(start > 0 && end > start)
  const card = source.slice(start, end)
  const label = source.match(/function topicActivityParticipationLabel\([^]*?\n\}/u)?.[0]
  assert.ok(label)
  const require = createRequire(join(process.cwd(), 'package.json'))
  const { chromium } = require('playwright') as typeof import('playwright')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> }
  const bundle = await esbuild.build({
    stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{RichPostContent}from'./components/posts/RichPostContent';import{formatDate}from'./lib/format';import{publicImageVariantUrl}from'./lib/image-variants';${label}
      const fixtures=${JSON.stringify(fixtures)};const selected=fixtures[new URLSearchParams(location.search).get('case')||'new'];const raw=${JSON.stringify(f.activity)};
      const topicActivity=selected.topic?{...raw,startsAt:new Date(raw.startsAt),endsAt:new Date(raw.endsAt)}:null;const topicActivityCoverUrl=null;const topicActivityMode='COMMENT';
      createRoot(document.getElementById('root')).render(<main><h1>{raw.title}</h1>${card}<RichPostContent fallbackContent={selected.body} className="actual-post-body"/></main>);`, resolveDir: process.cwd(), loader: 'tsx' },
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '""' },
    plugins: [{ name: 'local-next', setup(build: {
      onResolve(options: { filter: RegExp }, fn: (args: { path: string }) => { path: string; namespace: string }): void
      onLoad(options: { filter: RegExp; namespace: string }, fn: (args: { path: string }) => { contents: string; loader: string; resolveDir: string }): void
    }) {
      build.onResolve({ filter: /^next\/(link|image)$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('image') ? `import React from'react';export default function Image(props){return React.createElement('img',props)}` : `import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`, loader: 'js', resolveDir: process.cwd() }))
    } }],
  })
  const methods: string[] = []
  const server = createServer((req, res) => {
    methods.push(req.method || 'GET')
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  assert.equal((await fetch(origin)).status, 200)
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}), args: ['--disable-gpu'] })
  try {
    for (const width of [1280, 390]) await t.test(`${width}px new/legacy/user-authored/ordinary post body`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
      for (const [key, fixture] of Object.entries(fixtures)) {
        await page.goto(origin + '/?case=' + key)
        const body = page.locator('.actual-post-body')
        await body.waitFor()
        const text = await body.innerText()
        for (const line of fixture.body.split('\n').filter(Boolean)) assert.ok(text.includes(line), `${key} must preserve authored/legacy text: ${line}`)
        assert.equal(await page.getByRole('region', { name: '话题活动信息', exact: true }).count(), fixture.topic ? 1 : 0)
        if (key === 'new') {
          assert.equal(text.trim(), f.activity.description)
          assert.equal(await body.getByText('参与方式', { exact: true }).count(), 0)
          assert.equal(await body.getByText('活动时间', { exact: true }).count(), 0)
          assert.equal(await page.getByRole('heading', { name: f.activity.title, exact: true }).count(), 1)
        }
      }
      assert.deepEqual(errors, [])
      await page.close()
    })
    assert.ok(methods.every((method) => method === 'GET'))
  } finally { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
