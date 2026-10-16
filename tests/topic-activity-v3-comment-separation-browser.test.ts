import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'

test('V3 actual PostRepliesSection separates platform submissions from discussion at desktop and mobile widths', { skip: process.env.TOPIC_V3_SUBMISSIONS_BROWSER_QA !== '1' }, async () => {
  const dependencyRoot = process.env.TOPIC_V3_TEST_DEPENDENCY_ROOT || process.cwd()
  const require = createRequire(join(dependencyRoot, 'package.json'))
  const { chromium } = require('playwright') as typeof import('playwright')
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as { build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }> }
  const reactDomClient = require.resolve('react-dom/client')
  const bundle = await esbuild.build({
    stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{PostRepliesSection}from'./components/PostRepliesSection';
      const params=new URLSearchParams(location.search),isAdmin=params.get('role')==='admin',privateAccess=params.get('private')!=='false';
      const tab=params.has('topicPlatform')?'PLATFORM':params.get('topicTab')==='discussion'?'DISCUSSION':'ALL';
      const author={id:'user-one',uid:101,nickname:'提交用户',level:1,avatarUrl:null};const common={parentId:null,floorNumber:1,likeCount:2,isPinned:false,liked:false,mentions:[],createdAt:'2026-10-16T01:30:00.000Z',author};
      const platform={...common,id:'platform-comment',content:'【平台任务】小红书 · 不应出现的任务正文',topicActivitySubmission:{id:'submission-one',status:'PENDING',rewardEntryId:'entry-one',alreadyCounted:false,canViewPrivate:privateAccess,rewardSnapshotSafe:{platformName:'小红书',title:'冗余任务标题',instructions:'冗余任务说明全文',points:7},taskAssets:[{assetId:'asset-one',previewAccessUrl:'/api/activities/activity-one/assets/asset-one/preview'}]}};
      const discussion={...common,id:'discussion-one',floorNumber:2,content:'真正的活动讨论正文'};const nested={...common,id:'discussion-child',floorNumber:null,parentId:'discussion-one',content:'真实楼中楼内容',author:{...author,id:'user-two',nickname:'楼中楼用户'}};
      const rows=tab==='PLATFORM'?[platform]:tab==='DISCUSSION'?[discussion,nested]:[platform,discussion,nested];
      createRoot(document.getElementById('root')).render(<PostRepliesSection postId="post-one" postAuthorId="user-one" initialReplies={rows} initialReplyCount={rows.length} currentUserId="user-one" canInteract={true} canManageReplies={true} sort="floor" direction="asc" pagination={{page:1,pageSize:20,total:rows.length,totalPages:1}} topicActivityId="activity-one" canReviewTopicActivity={isAdmin} topicCommentTab={tab} topicPlatformFilter={tab==='PLATFORM'?'XIAOHONGSHU':undefined} topicPlatformTabs={[{platformKey:'XIAOHONGSHU',platformName:'小红书'}]}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', absWorkingDir: process.cwd(), nodePaths: [join(dependencyRoot, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.MEDIA_PUBLIC_BASE_URL': '""' },
    alias: { '@': process.cwd(), react: require.resolve('react'), 'react/jsx-runtime': require.resolve('react/jsx-runtime'), 'react-dom/client': reactDomClient, 'react-dom': require.resolve('react-dom'), scheduler: createRequire(reactDomClient).resolve('scheduler') },
    plugins: [{ name: 'next-framework-context-only', setup(build: { onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }): void; onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir?: string }): void }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: 'framework-fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'framework-fixture' }, () => ({ contents: `import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}export function useRouter(){return {push(url){location.assign(url)},refresh(){},replace(url){location.replace(url)}}}`, loader: 'js', resolveDir: dependencyRoot }))
    } }],
  })
  const postcss = require('postcss'), tailwind = require('tailwindcss')
  const css = (await postcss([tailwind({ ...require(join(process.cwd(), 'tailwind.config.ts')).default, content: [{ raw: bundle.outputFiles[0].text, extension: 'js' }] })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css
  let likeWrites = 0, unexpectedWrites = 0, screenshotReads = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const send = (data: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname === '/api/posts/post-one/replies') return send({ topicActivity: { commentPolicy: { requiresForm: false, gateMode: 'AFTER_FORM_SUBMIT', commentLimit: 'MULTIPLE' }, currentUserEligibility: { requiresForm: false, hasFormSubmission: false, hasAdminReply: false, hasUsedSingleComment: false, canComment: true, blockReason: null } } })
    if (url.pathname === '/api/replies/discussion-one/like' && req.method === 'POST') { likeWrites++; return send({ isLiked: true, likeCount: 3 }) }
    if (url.pathname === '/api/activities/activity-one/assets/asset-one/preview') { screenshotReads++; res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhL8AAAAASUVORK5CYII=', 'base64')); return }
    if (url.pathname.startsWith('/api/')) { if (req.method !== 'GET') unexpectedWrites++; return send({ items: [], stickers: [], friends: [] }) }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(existsSync(edge) ? { executablePath: edge } : {}) })
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      const page = await context.newPage(), pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      const open = (query: string) => page.goto(origin + '/posts/post-one?' + query)
      await open('topicPlatform=XIAOHONGSHU')
      const platform = page.locator('[data-platform-submission="submission-one"]')
      await platform.waitFor()
      assert.equal(await platform.locator('.post-reply-card').count(), 0)
      assert.equal(await page.locator('.post-reply-card').count(), 0)
      assert.equal(await page.locator('[data-post-primary-composer]').count(), 0)
      assert.equal(await platform.getByText('小红书', { exact: true }).count(), 1)
      assert.equal(await platform.getByRole('img', { name: '小红书提交截图 1' }).count(), 1)
      for (const content of ['【平台任务】小红书 · 不应出现的任务正文', '冗余任务标题', '冗余任务说明全文', '7 挂号费']) assert.equal(await page.getByText(content, { exact: true }).count(), 0)
      for (const name of [/点赞/, /^回复$/, /置顶/, /删除/, /^通过$/, /^拒绝$/]) assert.equal(await platform.getByRole('button', { name }).count(), 0)

      await open('topicPlatform=XIAOHONGSHU&private=false&role=admin')
      await platform.getByText('截图仅提交者和审核人员可见').waitFor()
      const readsBefore = screenshotReads
      assert.equal(await platform.locator('img[src*="asset-one"]').count(), 0)
      assert.equal(await platform.locator('a[href*="asset-one"]').count(), 0)
      assert.equal(await platform.getByRole('button', { name: '通过', exact: true }).count(), 1)
      assert.equal(await platform.getByRole('button', { name: '拒绝', exact: true }).count(), 1)
      assert.equal(screenshotReads, readsBefore)

      await open('topicTab=discussion')
      const discussion = page.locator('#reply-discussion-one')
      await discussion.getByText('真正的活动讨论正文', { exact: true }).waitFor()
      await discussion.getByText('真实楼中楼内容', { exact: false }).waitFor()
      assert.equal(await page.locator('[data-platform-submission]').count(), 0)
      assert.equal(await discussion.locator('.post-reply-card').count(), 1)
      const mainCard = discussion.locator('.post-reply-card')
      assert.equal(await mainCard.getByRole('button', { name: '回复', exact: true }).count(), 1)
      assert.equal(await mainCard.getByRole('button', { name: /置顶/ }).count(), 1)
      assert.equal(await mainCard.getByRole('button', { name: '删除', exact: true }).count(), 1)
      const likesBefore = likeWrites
      await mainCard.getByRole('button', { name: /^点赞 2$/ }).click()
      await mainCard.getByRole('button', { name: /^取消点赞 3$/ }).waitFor()
      assert.equal(likeWrites, likesBefore + 1)
      await page.locator('[data-post-primary-composer]').waitFor()
      await mainCard.getByRole('button', { name: '回复', exact: true }).click()
      if (width < 768) await page.getByRole('dialog').waitFor()
      else await page.locator('#reply-form-discussion-one textarea').waitFor()

      await open('')
      await page.locator('[data-platform-submission="submission-one"]').waitFor()
      assert.equal(await page.locator('.post-reply-card').count(), 1)
      await page.getByText('真正的活动讨论正文', { exact: true }).waitFor()
      await page.getByText('真实楼中楼内容', { exact: false }).waitFor()
      assert.equal(await page.locator('[data-platform-submission] .post-reply-card').count(), 0)
      assert.equal(await page.locator('[data-platform-submission]').getByRole('button', { name: /点赞|回复|置顶|删除/ }).count(), 0)
      await page.getByRole('tab', { name: '小红书', exact: true }).click()
      await page.waitForURL(/topicPlatform=XIAOHONGSHU/)
      await page.locator('[data-platform-submission]').waitFor()
      assert.equal(await page.locator('.post-reply-card').count(), 0)
      assert.deepEqual(pageErrors, [])
      await context.close()
    }
    assert.equal(unexpectedWrites, 0)
  } finally { await browser?.close(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
