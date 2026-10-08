import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'

// Real components and stylesheet; local HTTP fixtures. An Android/WeChat UA
// is NOT a real Android WeChat WebView or an iOS Safari physical QA result.
test('V6.1.1 browser: modal over actual sheet, independent IMAGE and live review filters', { skip: process.env.TOPIC_V611_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild')
  const entry = `
    import React,{useState,useRef,useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {PostReplyBottomSheet} from './components/PostReplyBottomSheet';
    import {SingleCommentConfirmDialog} from './components/activities/SingleCommentConfirmDialog';
    import {PostRepliesSection} from './components/PostRepliesSection';
    import {TopicActivityFormParticipation} from './components/activities/TopicActivityFormParticipation';
    import {TopicActivityFormDesigner} from './components/activities/TopicActivityFormDesigner';
    function Composer(){const [open,setOpen]=useState(true),[confirm,setConfirm]=useState(false),[draft,setDraft]=useState('');const decision=useRef(null);function before(){setConfirm(true);return new Promise(resolve=>decision.current=resolve)}function resolve(value){setConfirm(false);const done=decision.current;decision.current=null;done?.(value)}return <div style={{transform:'translateZ(0)',position:'relative',zIndex:1}}><PostReplyBottomSheet open={open} postId="post-fixture" onClose={()=>setOpen(false)} onReplyCreated={()=>{}} draftContent={draft} onDraftChange={setDraft} onDraftClear={()=>setDraft('')} beforeSubmit={before} confirmationOpen={confirm} onConfirmationCancel={()=>resolve(false)} allowImageAttachments={true} isTopicRootComment/><SingleCommentConfirmDialog open={confirm} onCancel={()=>resolve(false)} onConfirm={()=>resolve(true)}/></div>}
    function Reviews(){const [view,setView]=useState(null);async function load(){const params=new URLSearchParams(location.search),filter=params.get('topicStatus')||'PENDING';const res=await fetch('/api/posts/post-fixture/replies?topicStatus='+filter+'&page='+(params.get('commentPage')||1));const data=await res.json();setView({filter,...data})}useEffect(()=>{load();window.addEventListener('fixture:navigate',load);return()=>window.removeEventListener('fixture:navigate',load)},[]);return view?<PostRepliesSection postId="post-fixture" initialReplies={view.replies} initialMyReplies={view.replies.filter(r=>r.author.id==='admin-1')} initialReplyCount={view.total} postAuthorId="admin-1" currentUserId="admin-1" canInteract={false} canManageReplies canReviewTopicActivity topicActivityId="activity-fixture" topicReviewFilter={view.filter} initialTopicReviewCounts={view.topicActivity.reviewCounts} sort="floor" direction="asc" pagination={{page:view.page,pageSize:20,total:view.total,totalPages:view.totalPages}}/>:null}
    function Images(){const [schema,setSchema]=useState({version:1,fields:[]});return <><TopicActivityFormDesigner schema={schema} allowImages={false} onSchemaChange={setSchema} onAllowImagesChange={()=>{}}/><TopicActivityFormParticipation activityId="activity-fixture" isAuthenticated/><PostReplyBottomSheet open postId="post-fixture" onClose={()=>{}} onReplyCreated={()=>{}} draftContent="" onDraftChange={()=>{}} onDraftClear={()=>{}} allowImageAttachments={false}/></>}
    createRoot(document.getElementById('root')).render(location.pathname==='/images'?<Images/>:location.search.includes('review')?<Reviews/>:<Composer/>);
  `
  const built = await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'navigation-fixture', setup(build: { onResolve: (o: { filter: RegExp }, f: (a: { path: string }) => { path: string; namespace: string }) => void; onLoad: (o: { filter: RegExp; namespace: string }, f: () => { contents: string; loader: string }) => void }) {
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export function usePathname(){return '/posts/post-fixture'}export function useSearchParams(){return new URLSearchParams(location.search)}export function useRouter(){return {refresh(){window.fixtureRefreshes=(window.fixtureRefreshes||0)+1},push(href){history.pushState({},'',href);window.dispatchEvent(new Event('fixture:navigate'))}}}`, loader: 'js' }))
  } }] })
  const bundle = built.outputFiles[0].text
  // Generate the production CSS utilities in memory, not invented z-index CSS.
  const postcss = require('postcss'), tailwind = require('tailwindcss')
  const tailwindConfig = require('./tailwind.config.ts').default
  const css = (await postcss([tailwind({ ...tailwindConfig, content: [{ raw: bundle, extension: 'js' }] })]).process(readFileSync('app/globals.css', 'utf8'), { from: join(process.cwd(), 'app/globals.css') })).css
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64')
  let commentRequests = 0, uploads = 0, reviewRequests = 0, failComment = false, failReview = false
  type Status = 'PENDING' | 'APPROVED' | 'REJECTED'
  let statuses: Status[] = ['PENDING', 'PENDING']
  const formBodies: Array<Record<string, unknown>> = []
  const fields = [{ id: 'photo', label: '单张凭证', type: 'IMAGE', required: true, options: [], placeholder: null, multiple: false, maxImages: 1 }]
  const row = (index: number) => ({ id: 'comment-' + index, content: index === 0 ? '管理员自己的参与评论' : '其他用户的参与评论', parentId: null, floorNumber: index + 1, likeCount: 0, isPinned: false, liked: false, createdAt: '2026-10-09T00:00:00Z', mentions: [], topicActivitySubmission: { id: 'submission-' + index, status: statuses[index], alreadyCounted: false }, author: { id: index === 0 ? 'admin-1' : 'user-2', uid: index + 1, nickname: index === 0 ? '管理员本人' : '其他用户', level: 1 } })
  const counts = () => ({ PENDING: statuses.filter(s => s === 'PENDING').length, APPROVED: statuses.filter(s => s === 'APPROVED').length, REJECTED: statuses.filter(s => s === 'REJECTED').length, WITHDRAWN: 0, ALL: statuses.length })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const json = (data: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return }
    if (url.pathname === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
    if (url.pathname === '/image.png') { res.setHeader('Content-Type', 'image/png'); res.end(imageBytes); return }
    if (req.method === 'POST' && url.pathname === '/api/posts/post-fixture/replies') {
      commentRequests++; for await (const chunk of req) void chunk
      await new Promise(resolve => setTimeout(resolve, 100))
      if (failComment) { res.statusCode = 500; json({ message: '评论暂时无法发送，请稍后重试' }); return }
      json({ success: true, reply: { ...row(0), id: 'sent-comment' } }); return
    }
    if (req.method === 'GET' && url.pathname === '/api/posts/post-fixture/replies') {
      const filter = url.searchParams.get('topicStatus')
      const roots = statuses.map((_, index) => row(index)).filter(r => !filter || filter === 'ALL' || r.topicActivitySubmission.status === filter)
      const totalPages = Math.max(1, Math.ceil(roots.length / 20))
      const page = Math.min(totalPages, Math.max(1, Number(url.searchParams.get('page')) || 1))
      json({ replies: roots.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: roots.length, totalPages, topicActivity: { reviewCounts: counts() } }); return
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/topic-activity-submissions/')) {
      reviewRequests++; let body = ''; for await (const chunk of req) body += chunk
      await new Promise(resolve => setTimeout(resolve, 100))
      if (failReview) { res.statusCode = 500; json({ message: '审核失败，请重试' }); return }
      const index = Number(url.pathname.split('-').pop()); statuses[index] = JSON.parse(body).status
      json({ submission: { id: 'submission-' + index, status: statuses[index] }, alreadyCounted: false }); return
    }
    if (url.pathname.endsWith('/form')) { json({ schema: { version: 1, fields }, allowImageAttachments: false, activity: { activityPostId: 'post-fixture' } }); return }
    if (url.pathname.endsWith('/my-form-submissions')) { json({ submissions: [], total: 0, hasMore: false }); return }
    if (url.pathname === '/api/uploads/topic-activity-image') { uploads++; for await (const chunk of req) void chunk; json({ asset: { assetId: 'asset-1', storageKey: 'fixture/image.png', url: '/image.png', thumbnailUrl: '/image.png', mimeType: 'image/png', width: 1, height: 1, size: imageBytes.length } }); return }
    if (url.pathname === '/api/uploads/content-image') { for await (const chunk of req) void chunk; json({ url: '/image.png', mimeType: 'image/png' }); return }
    if (req.method === 'POST' && url.pathname.endsWith('/form-submissions')) { let body = ''; for await (const chunk of req) body += chunk; formBodies.push(JSON.parse(body)); json({ success: true }); return }
    if (url.pathname.startsWith('/api/')) { json({ stickers: [], categories: [], friends: [] }); return }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  let browser: Browser | null = null
  try {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    await t.test('Android WeChat UA: short content never confirms; cancel preserves text/image; top dialog receives touch; duplicate blocked', async () => {
      const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile MicroMessenger/8.0' })
      await page.goto(origin + '/posts/post-fixture')
      const sheet = page.getByRole('dialog', { name: '回复帖子', exact: true })
      const input = sheet.locator('textarea')
      await input.fill('字')
      await sheet.getByRole('button', { name: '发布回复' }).click()
      await page.getByRole('alert').filter({ hasText: '参与评论至少需要 2 个字符' }).waitFor()
      assert.equal(await page.getByRole('dialog', { name: '确认发送参与评论' }).count(), 0)
      assert.equal(commentRequests, 0)
      await input.fill('有效参与草稿')
      await sheet.locator('input[type=file]').first().setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: imageBytes })
      const preview = sheet.getByRole('img', { name: '已上传内容，拖拽可调整顺序' }).first()
      await preview.waitFor()
      const previewSource = await preview.getAttribute('src')
      await sheet.getByRole('button', { name: '发布回复' }).click()
      const confirm = page.getByRole('dialog', { name: '确认发送参与评论' })
      await confirm.waitFor()
      const button = confirm.getByRole('button', { name: '返回检查' })
      assert.equal(await button.evaluate(el => { const b=el.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===el }), true)
      assert.equal(await confirm.evaluate(el => el.parentElement?.parentElement === document.body), true)
      assert.equal(await sheet.getAttribute('inert'), '')
      await button.tap()
      assert.equal(await input.inputValue(), '有效参与草稿')
      assert.equal(await preview.getAttribute('src'), previewSource)
      assert.equal(commentRequests, 0)
      await sheet.getByRole('button', { name: '发布回复' }).click()
      await page.keyboard.press('Escape')
      assert.equal(await input.inputValue(), '有效参与草稿')
      assert.equal(await sheet.isVisible(), true)
      await sheet.getByRole('button', { name: '发布回复' }).click()
      await confirm.waitFor()
      await page.evaluate(() => history.back())
      await confirm.waitFor({ state: 'hidden' })
      assert.equal(await input.inputValue(), '有效参与草稿')
      assert.equal(await preview.getAttribute('src'), previewSource)
      assert.equal(await sheet.isVisible(), true)
      assert.equal(commentRequests, 0)
      failComment = true
      await sheet.getByRole('button', { name: '发布回复' }).click()
      await page.getByRole('button', { name: '确认发送', exact: true }).evaluate((el: HTMLButtonElement) => { el.click(); el.click() })
      await sheet.getByRole('alert').filter({ hasText: '评论暂时无法发送' }).waitFor()
      assert.equal(commentRequests, 1)
      assert.equal(await input.inputValue(), '有效参与草稿')
      failComment = false
      await sheet.getByRole('button', { name: '发布回复' }).click()
      await page.getByRole('button', { name: '确认发送', exact: true }).tap()
      await page.waitForFunction(() => !document.querySelector('.post-reply-bottom-sheet'))
      assert.equal(commentRequests, 2)
      await page.close()
    })
    await t.test('field IMAGE remains selectable/uploadable at one image while comment uploader is absent', async () => {
      const page = await browser!.newPage({ viewport: { width: 1100, height: 800 } })
      await page.goto(origin + '/images')
      const add = page.getByRole('button', { name: '+ 添加图片字段', exact: true })
      assert.equal(await add.isEnabled(), true); await add.click()
      await page.getByRole('button', { name: '填写参与表单', exact: true }).click()
      const form = page.locator('form').first()
      assert.equal(await form.getByRole('button', { name: '上传图片', exact: true }).count(), 1)
      const file = form.locator('input[type=file]')
      const photo = { name: 'one.png', mimeType: 'image/png', buffer: imageBytes }
      await file.evaluate(el => { (el as HTMLInputElement).multiple = true })
      await file.setInputFiles([photo, { ...photo, name: 'two.png' }])
      await form.getByRole('alert').filter({ hasText: '最多选择 1 张图片' }).waitFor()
      assert.equal(uploads, 0)
      await file.setInputFiles(photo)
      await form.getByRole('img', { name: '已选择的图片附件' }).waitFor()
      assert.equal(uploads, 1)
      assert.equal(await form.getByRole('button', { name: '上传图片', exact: true }).isDisabled(), true)
      await form.getByRole('button', { name: '移除图片' }).click()
      assert.equal(await form.getByRole('button', { name: '上传图片', exact: true }).isEnabled(), true)
      await file.setInputFiles(photo)
      await form.getByRole('img', { name: '已选择的图片附件' }).waitFor()
      await form.locator('button[type=submit]').click()
      await page.getByText('表单已提交成功。', { exact: false }).waitFor()
      assert.deepEqual((formBodies[0].answers as Record<string, unknown>).photo, ['asset-1'])
      assert.equal(await page.locator('.post-reply-form .post-content-image-uploader').count(), 0)
      await page.close()
    })
    await t.test('admin self-review and rejection leave pending; counts sync; failed review stays; no route refresh', async () => {
      statuses = ['PENDING', 'PENDING']; reviewRequests = 0
      const page = await browser!.newPage({ viewport: { width: 1024, height: 768 } })
      await page.goto(origin + '/posts/post-fixture?review=1&topicStatus=PENDING')
      const own = page.locator('#reply-comment-0')
      await own.getByRole('button', { name: '通过', exact: true }).click()
      failReview = true
      await page.getByRole('button', { name: '确认通过' }).click()
      await page.getByText('审核失败，请重试', { exact: true }).waitFor()
      assert.equal(await own.count(), 1)
      failReview = false
      await page.getByRole('button', { name: '确认通过' }).click()
      await own.waitFor({ state: 'hidden' })
      await page.getByRole('tab', { name: '待审核（1）', exact: true }).waitFor()
      const other = page.locator('#reply-comment-1')
      await other.getByRole('button', { name: '拒绝', exact: true }).click()
      await page.getByRole('button', { name: '确认拒绝' }).click()
      await other.waitFor({ state: 'hidden' })
      await page.getByRole('tab', { name: '待审核（0）', exact: true }).waitFor()
      await page.getByRole('tab', { name: '已通过（1）', exact: true }).click()
      await page.locator('#reply-comment-0').waitFor()
      await page.getByRole('tab', { name: '已拒绝（1）', exact: true }).click()
      await page.locator('#reply-comment-1').waitFor()
      assert.equal(reviewRequests, 3, 'failed attempt + 2 changed reviews, no automatic review retry')
      assert.equal(await page.evaluate(() => (window as unknown as { fixtureRefreshes?: number }).fixtureRefreshes || 0), 0)
      await page.close()
    })
    await t.test('filtered page is refilled after review without reloading or resetting scroll', async () => {
      statuses = Array<Status>(21).fill('PENDING'); reviewRequests = 0
      const page = await browser!.newPage({ viewport: { width: 1024, height: 768 } })
      await page.goto(origin + '/posts/post-fixture?review=1&topicStatus=PENDING')
      await page.locator('#reply-comment-0').waitFor()
      assert.equal(await page.locator('#reply-comment-20').count(), 0)
      await page.locator('#reply-comment-0').getByRole('button', { name: '通过', exact: true }).click()
      await page.evaluate(() => window.scrollTo(0, 180))
      const scrollBeforeReview = await page.evaluate(() => window.scrollY)
      await page.getByRole('button', { name: '确认通过' }).click()
      await page.locator('#reply-comment-20').waitFor()
      await page.getByRole('tab', { name: '待审核（20）', exact: true }).waitFor()
      await page.getByRole('tab', { name: '全部（21）', exact: true }).waitFor()
      assert.equal(await page.locator('#reply-comment-0').count(), 0)
      assert.equal(await page.locator('[id^="reply-comment-"]').count(), 20)
      assert.equal(await page.evaluate(() => (window as unknown as { fixtureRefreshes?: number }).fixtureRefreshes || 0), 0)
      assert.match(page.url(), /topicStatus=PENDING/)
      assert.equal(await page.evaluate(() => window.scrollY), scrollBeforeReview)
      assert.equal(reviewRequests, 1)
      await page.close()
    })
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
